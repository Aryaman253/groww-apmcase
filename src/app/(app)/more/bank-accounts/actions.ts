"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/server/context";
import { logActivity } from "@/lib/server/activity";
import { encrypt } from "@/lib/crypto";
import { accountSchema, ifscSchema } from "@/lib/schemas";
import { last4, normalizeAccount } from "@/lib/validation";

const schema = z
  .object({
    bankName: z.string().trim().min(1).max(80),
    nickname: z.string().trim().min(1).max(60),
    accountNumber: accountSchema,
    accountNumberConfirm: z.string(),
    ifsc: ifscSchema,
    templateId: z.uuid().nullable(),
  })
  .refine((v) => normalizeAccount(v.accountNumberConfirm) === v.accountNumber, { path: ["accountNumberConfirm"], message: "accountMismatch" });

export async function addDebitAccount(input: z.input<typeof schema>) {
  const ctx = await requireOwner();
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false as const, fieldErrors: Object.fromEntries(p.error.issues.map((i) => [i.path.join("."), i.message])) };
  const { count } = await ctx.supabase.from("debit_accounts").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.wsId).is("deleted_at", null);
  const { data, error } = await ctx.supabase
    .from("debit_accounts")
    .insert({
      workspace_id: ctx.wsId,
      bank_name: p.data.bankName,
      nickname: p.data.nickname,
      ifsc: p.data.ifsc,
      account_last4: last4(p.data.accountNumber),
      account_number_enc: encrypt(p.data.accountNumber),
      bank_template_id: p.data.templateId,
      is_default: !count,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false as const, fieldErrors: {} };
  await logActivity(ctx, ctx.wsId, "debit_account.added", { type: "debit_account", id: data.id }, { last4: last4(p.data.accountNumber) });
  revalidatePath("/more/bank-accounts");
  return { ok: true as const };
}

export async function setDefaultDebitAccount(id: string) {
  const ctx = await requireOwner();
  const aid = z.uuid().parse(id);
  await ctx.supabase.from("debit_accounts").update({ is_default: false }).eq("workspace_id", ctx.wsId);
  await ctx.supabase.from("debit_accounts").update({ is_default: true }).eq("id", aid).eq("workspace_id", ctx.wsId);
  revalidatePath("/more/bank-accounts");
}

export async function setDebitTemplate(id: string, templateId: string | null) {
  const ctx = await requireOwner();
  await ctx.supabase
    .from("debit_accounts")
    .update({ bank_template_id: templateId ? z.uuid().parse(templateId) : null })
    .eq("id", z.uuid().parse(id))
    .eq("workspace_id", ctx.wsId);
  revalidatePath("/more/bank-accounts");
}

export async function removeDebitAccount(id: string) {
  const ctx = await requireOwner();
  await ctx.supabase.from("debit_accounts").update({ deleted_at: new Date().toISOString(), is_default: false }).eq("id", z.uuid().parse(id)).eq("workspace_id", ctx.wsId);
  revalidatePath("/more/bank-accounts");
}
