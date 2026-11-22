"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext, requireOwner, WORKSPACE_COOKIE, type WorkspaceSettings } from "@/lib/server/context";
import { logActivity } from "@/lib/server/activity";
import { isValidGstin } from "@/lib/validation";
import type { Json } from "@/lib/supabase/database.types";
import { slugify } from "@/lib/slug";

export async function createWorkspace(_prev: unknown, formData: FormData) {
  const parsed = z.string().trim().min(1).max(120).safeParse(formData.get("name"));
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase
    .from("workspaces")
    .insert({ name: parsed.data, slug: slugify(parsed.data), created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "DB" };
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, data.id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  redirect("/home");
}

export async function switchWorkspace(workspaceId: string) {
  const id = z.uuid().parse(workspaceId);
  await requireOwner(id);
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legal_name: z.string().trim().max(160).optional().or(z.literal("")),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidGstin(v), "INVALID_GSTIN"),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.email().optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function updateProfile(input: z.input<typeof profileSchema>) {
  const ctx = await requireOwner();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "INVALID" };
  const v = parsed.data;
  const { error } = await ctx.supabase
    .from("workspaces")
    .update({
      name: v.name,
      legal_name: v.legal_name || null,
      gstin: v.gstin || null,
      phone: v.phone || null,
      email: v.email || null,
      address: v.address || null,
    })
    .eq("id", ctx.wsId);
  if (error) return { ok: false as const, error: "DB" };
  await logActivity(ctx, ctx.wsId, "settings.updated", undefined, { section: "profile" });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

const settingsSchema = z.object({
  hold24h: z.boolean().optional(),
  keepInvoiceImages: z.boolean().optional(),
  tourDone: z.boolean().optional(),
  rtgsMinPaise: z.number().int().positive().optional(),
  defaultMethod: z.enum(["direct", "bank_file", "upi"]).optional(),
});

export async function updateSettings(patch: WorkspaceSettings) {
  const ctx = await requireOwner();
  const parsed = settingsSchema.safeParse(patch);
  if (!parsed.success) return { ok: false as const };
  const settings = { ...((ctx.workspace.settings ?? {}) as WorkspaceSettings), ...parsed.data };
  const { error } = await ctx.supabase
    .from("workspaces")
    .update({ settings: settings as Json })
    .eq("id", ctx.wsId);
  if (error) return { ok: false as const };
  if (!("tourDone" in parsed.data && Object.keys(parsed.data).length === 1)) {
    await logActivity(ctx, ctx.wsId, "settings.updated", undefined, { keys: Object.keys(parsed.data) });
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
  redirect("/");
}

export async function currentWorkspaceId() {
  return (await getAppContext()).workspace.id;
}
