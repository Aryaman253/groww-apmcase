"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/server/context";
import { logActivity } from "@/lib/server/activity";
import { encrypt, decrypt, randomToken, sha256 } from "@/lib/crypto";
import { bankDetailsSchema, vendorProfileSchema, type BankDetailsInput, type VendorProfileInput } from "@/lib/schemas";
import { last4 } from "@/lib/validation";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(issues: z.core.$ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = i.path.join(".");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

type BankSource = "manual" | "autofill" | "vendor_link";

function hasBank(b: z.output<typeof bankDetailsSchema>) {
  return Boolean(b.accountNumber || b.upiId);
}

export async function createVendor(input: {
  profile: VendorProfileInput;
  bank?: BankDetailsInput;
  source?: BankSource;
}): Promise<Result<{ id: string }>> {
  const ctx = await requireOwner();
  const p = vendorProfileSchema.safeParse(input.profile);
  const b = bankDetailsSchema.safeParse(input.bank ?? {});
  if (!p.success || !b.success) {
    return {
      ok: false,
      error: "INVALID",
      fieldErrors: { ...(p.success ? {} : fieldErrors(p.error.issues)), ...(b.success ? {} : prefix(fieldErrors(b.error.issues), "bank.")) },
    };
  }
  const v = p.data;
  const { data: vendor, error } = await ctx.supabase
    .from("vendors")
    .insert({
      workspace_id: ctx.wsId,
      display_name: v.displayName,
      legal_name: v.legalName ?? null,
      gstin: v.gstin ?? null,
      phone: v.phone ?? null,
      email: v.email ?? null,
      credit_days: v.creditDays,
      notes: v.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !vendor) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "vendor.created", { type: "vendor", id: vendor.id }, { name: v.displayName });
  if (hasBank(b.data)) {
    const res = await insertBankVersion(ctx, vendor.id, b.data, input.source ?? "manual", null);
    if (!res.ok) return res;
  }
  revalidatePath("/vendors");
  return { ok: true, data: { id: vendor.id } };
}

function prefix(o: Record<string, string>, p: string) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v]));
}

async function insertBankVersion(
  ctx: Awaited<ReturnType<typeof requireOwner>>,
  vendorId: string,
  b: z.output<typeof bankDetailsSchema>,
  source: BankSource,
  previous: { account_last4: string | null; ifsc: string | null; upi_id: string | null } | null,
): Promise<Result<{ id: string }>> {
  const { data, error } = await ctx.supabase
    .from("vendor_bank_details")
    .insert({
      workspace_id: ctx.wsId,
      vendor_id: vendorId,
      version: 0, // assigned by trigger
      account_holder_name: b.accountHolderName ?? null,
      account_number_enc: b.accountNumber ? encrypt(b.accountNumber) : null,
      account_last4: b.accountNumber ? last4(b.accountNumber) : null,
      ifsc: b.ifsc ?? null,
      bank_name: b.bankName ?? null,
      branch: b.branch ?? null,
      upi_id: b.upiId ?? null,
      status: "pending",
      source,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "bank_details.changed", { type: "vendor", id: vendorId }, {
    source,
    old_last4: previous?.account_last4 ?? null,
    new_last4: b.accountNumber ? last4(b.accountNumber) : null,
    old_ifsc: previous?.ifsc ?? null,
    new_ifsc: b.ifsc ?? null,
    old_upi: previous?.upi_id ?? null,
    new_upi: b.upiId ?? null,
  });
  return { ok: true, data: { id: data.id } };
}

export async function updateVendorProfile(vendorId: string, input: VendorProfileInput): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(vendorId);
  const p = vendorProfileSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "INVALID", fieldErrors: fieldErrors(p.error.issues) };
  const v = p.data;
  const { error } = await ctx.supabase
    .from("vendors")
    .update({
      display_name: v.displayName,
      legal_name: v.legalName ?? null,
      gstin: v.gstin ?? null,
      phone: v.phone ?? null,
      email: v.email ?? null,
      credit_days: v.creditDays,
      notes: v.notes ?? null,
    })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId);
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "vendor.updated", { type: "vendor", id });
  revalidatePath(`/vendors/${id}`);
  return { ok: true };
}

/** Any change to account number, IFSC or UPI creates a pending version → vendor blocked until reviewed. */
export async function changeBankDetails(vendorId: string, input: BankDetailsInput, source: BankSource = "manual"): Promise<Result<{ id: string }>> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(vendorId);
  const b = bankDetailsSchema.safeParse(input);
  if (!b.success) return { ok: false, error: "INVALID", fieldErrors: fieldErrors(b.error.issues) };
  if (!hasBank(b.data)) return { ok: false, error: "INVALID", fieldErrors: { accountNumber: "accountOrUpi" } };
  const { data: prev } = await ctx.supabase
    .from("vendor_bank_details")
    .select("account_last4, ifsc, upi_id")
    .eq("vendor_id", id)
    .eq("workspace_id", ctx.wsId)
    .eq("status", "approved")
    .maybeSingle();
  const res = await insertBankVersion(ctx, id, b.data, source, prev ?? null);
  revalidatePath(`/vendors/${id}`);
  revalidatePath("/vendors");
  return res;
}

export async function reviewBankDetails(detailId: string, approve: boolean): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(detailId);
  const { data: d } = await ctx.supabase
    .from("vendor_bank_details")
    .select("vendor_id, account_last4, ifsc, upi_id, workspace_id")
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .maybeSingle();
  if (!d) return { ok: false, error: "NOT_FOUND" };
  const { error } = await ctx.supabase.rpc("review_bank_details", { p_id: id, p_approve: approve });
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, approve ? "bank_details.approved" : "bank_details.rejected", { type: "vendor", id: d.vendor_id }, {
    last4: d.account_last4,
    ifsc: d.ifsc,
    upi: d.upi_id,
  });
  revalidatePath(`/vendors/${d.vendor_id}`);
  revalidatePath("/vendors");
  revalidatePath("/home");
  return { ok: true };
}

/** Full account number, only for the approval comparison view after an explicit "Show". */
export async function revealAccountNumber(detailId: string): Promise<Result<{ accountNumber: string }>> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(detailId);
  const { data } = await ctx.supabase
    .from("vendor_bank_details")
    .select("account_number_enc, status")
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .maybeSingle();
  if (!data?.account_number_enc || !["pending", "approved"].includes(data.status)) return { ok: false, error: "NOT_FOUND" };
  return { ok: true, data: { accountNumber: decrypt(data.account_number_enc) } };
}

export async function deleteVendor(vendorId: string): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(vendorId);
  const { error } = await ctx.supabase
    .from("vendors")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId);
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "vendor.deleted", { type: "vendor", id });
  revalidatePath("/vendors");
  return { ok: true };
}

/** Single-use link, valid 7 days; only the hash of the token is stored. */
export async function createVendorRequest(input: { vendorId?: string; lang: "en" | "hi" }): Promise<Result<{ url: string; expiresAt: string }>> {
  const ctx = await requireOwner();
  const vendorId = input.vendorId ? z.uuid().parse(input.vendorId) : null;
  const token = randomToken(24);
  const { data, error } = await ctx.supabase
    .from("vendor_requests")
    .insert({ workspace_id: ctx.wsId, vendor_id: vendorId, token_hash: sha256(token), lang: input.lang })
    .select("id, expires_at")
    .single();
  if (error || !data) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "vendor_request.created", vendorId ? { type: "vendor", id: vendorId } : undefined);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return { ok: true, data: { url: `${base}/v/${token}`, expiresAt: data.expires_at } };
}

export async function logExtraction(input: {
  kind: "vendor" | "invoice";
  sourceType: "paste" | "image" | "pdf";
  engine?: string;
  parserVersion: string;
  fields: Record<string, { confidence: number; present: boolean }>;
  correctedFields: string[];
  durationMs?: number;
}) {
  const ctx = await requireOwner();
  const schema = z.object({
    kind: z.enum(["vendor", "invoice"]),
    sourceType: z.enum(["paste", "image", "pdf"]),
    engine: z.string().max(20).optional(),
    parserVersion: z.string().max(20),
    fields: z.record(z.string().max(40), z.object({ confidence: z.number().min(0).max(1), present: z.boolean() })),
    correctedFields: z.array(z.string().max(40)).max(30),
    durationMs: z.number().int().nonnegative().optional(),
  });
  const v = schema.parse(input);
  await ctx.supabase.from("extraction_logs").insert({
    workspace_id: ctx.wsId,
    kind: v.kind,
    source_type: v.sourceType,
    engine: v.engine ?? null,
    parser_version: v.parserVersion,
    fields: v.fields,
    corrected_fields: v.correctedFields,
    duration_ms: v.durationMs ?? null,
  });
}
