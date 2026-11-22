"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/server/context";
import { logActivity } from "@/lib/server/activity";
import { encrypt } from "@/lib/crypto";
import { razorpayx } from "@/lib/rails/razorpayx";
import { cashfree } from "@/lib/rails/cashfree";
import { parseBankTemplateConfig } from "@/lib/bankfile";
import type { Json } from "@/lib/supabase/database.types";

const rzpSchema = z.object({
  provider: z.literal("razorpayx"),
  keyId: z.string().trim().regex(/^rzp_test_[A-Za-z0-9]+$/, "testKeysOnly"),
  keySecret: z.string().trim().min(8).max(100),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/),
  webhookSecret: z.string().trim().min(8).max(100),
});
const cfSchema = z.object({
  provider: z.literal("cashfree"),
  clientId: z.string().trim().min(4).max(100),
  clientSecret: z.string().trim().min(8).max(200),
  webhookSecret: z.string().trim().max(200).optional(),
});

/** Connects the workspace's OWN payout account (test credentials only). Credentials are encrypted server-side. */
export async function connectProvider(input: z.input<typeof rzpSchema> | z.input<typeof cfSchema>) {
  const ctx = await requireOwner();
  const parsed = z.discriminatedUnion("provider", [rzpSchema, cfSchema]).safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: parsed.error.issues[0]?.message ?? "invalid" };
  const v = parsed.data;
  try {
    if (v.provider === "razorpayx") {
      const bal = await razorpayx({ keyId: v.keyId, keySecret: v.keySecret, accountNumber: v.accountNumber }).getBalance();
      if (bal === null) return { ok: false as const, reason: "account number not found" };
    } else {
      await cashfree({ clientId: v.clientId, clientSecret: v.clientSecret }).getPayout({ referenceId: "connection-check" });
    }
  } catch (e) {
    return { ok: false as const, reason: e instanceof Error ? e.message : "connection failed" };
  }
  const creds = v.provider === "razorpayx" ? { keyId: v.keyId, keySecret: v.keySecret, webhookSecret: v.webhookSecret } : { clientId: v.clientId, clientSecret: v.clientSecret, webhookSecret: v.webhookSecret || v.clientSecret };
  const { error } = await ctx.supabase.from("payout_providers").upsert(
    {
      workspace_id: ctx.wsId,
      provider: v.provider,
      mode: "test",
      credentials_enc: encrypt(JSON.stringify(creds)),
      account_number: v.provider === "razorpayx" ? v.accountNumber : null,
      status: "connected",
      uses_app_demo_keys: false,
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) return { ok: false as const, reason: "database" };
  await logActivity(ctx, ctx.wsId, "provider.connected", undefined, { provider: v.provider, test_mode: true });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function disconnectProvider() {
  const ctx = await requireOwner();
  await ctx.supabase.from("payout_providers").delete().eq("workspace_id", ctx.wsId);
  await logActivity(ctx, ctx.wsId, "provider.disconnected");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Copies a system template into the workspace so it can be edited. */
export async function copyTemplate(templateId: string) {
  const ctx = await requireOwner();
  const { data: tpl } = await ctx.supabase.from("bank_templates").select("key, name, config").eq("id", z.uuid().parse(templateId)).maybeSingle();
  if (!tpl) return { ok: false };
  const key = `${tpl.key}_custom_${Date.now().toString(36)}`;
  const config = { ...(tpl.config as Record<string, unknown>), key, name: `${tpl.name} (copy)` };
  await ctx.supabase.from("bank_templates").insert({ workspace_id: ctx.wsId, key, name: `${tpl.name} (copy)`, config: config as Json });
  revalidatePath("/more/settings");
  return { ok: true };
}

export async function saveTemplate(templateId: string, json: string) {
  const ctx = await requireOwner();
  let config: unknown;
  try {
    config = parseBankTemplateConfig(JSON.parse(json));
  } catch (e) {
    return { ok: false as const, reason: e instanceof Error ? e.message.slice(0, 200) : "invalid" };
  }
  const name = (config as { name?: string }).name ?? "Custom format";
  const { error } = await ctx.supabase
    .from("bank_templates")
    .update({ config: JSON.parse(json) as Json, name })
    .eq("id", z.uuid().parse(templateId))
    .eq("workspace_id", ctx.wsId);
  if (error) return { ok: false as const, reason: "database" };
  revalidatePath("/more/settings");
  return { ok: true as const };
}
