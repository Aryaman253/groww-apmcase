"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/server/context";
import { logActivity } from "@/lib/server/activity";
import { billSchema, type BillInput } from "@/lib/schemas";
import { computeDueDate } from "@/lib/dates";
import { findDuplicateBills } from "@/lib/payments";
import { ImportPresetSchema } from "@/lib/import";
import type { Json } from "@/lib/supabase/database.types";

type Dup = { billId: string; invoiceNumber: string; amountPaise: number; invoiceDate: string | null; reason: "same_invoice_number" | "same_amount_and_date" };
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string>; duplicates?: Dup[] };

function revalidateBills() {
  revalidatePath("/bills");
  revalidatePath("/home");
  revalidatePath("/vendors");
}

async function existingBillsFor(ctx: Awaited<ReturnType<typeof requireOwner>>, vendorIds: string[]) {
  if (!vendorIds.length) return [];
  const { data } = await ctx.supabase
    .from("bills")
    .select("id, vendor_id, invoice_number, invoice_date, amount_paise")
    .eq("workspace_id", ctx.wsId)
    .is("deleted_at", null)
    .in("vendor_id", vendorIds);
  return (data ?? []).map((b) => ({ id: b.id, vendorId: b.vendor_id, invoiceNumber: b.invoice_number, invoiceDate: b.invoice_date, amountPaise: b.amount_paise }));
}

export async function createBill(input: BillInput): Promise<Result<{ id: string }>> {
  const ctx = await requireOwner();
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "INVALID", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])) };
  }
  const v = parsed.data;
  const { data: vendor } = await ctx.supabase
    .from("vendors")
    .select("id, credit_days, display_name")
    .eq("id", v.vendorId)
    .eq("workspace_id", ctx.wsId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!vendor) return { ok: false, error: "INVALID", fieldErrors: { vendorId: "vendor" } };
  const due = computeDueDate({ printedDueDate: v.dueDate, invoiceDate: v.invoiceDate, creditDays: vendor.credit_days });
  if (!due) return { ok: false, error: "INVALID", fieldErrors: { dueDate: "needDueOrInvoiceDate" } };
  if (!v.allowDuplicate) {
    const dups = findDuplicateBills(
      { vendorId: v.vendorId, invoiceNumber: v.invoiceNumber, amountPaise: v.amountPaise, invoiceDate: v.invoiceDate ?? null },
      await existingBillsFor(ctx, [v.vendorId]),
    );
    if (dups.length) {
      return {
        ok: false,
        error: "DUPLICATE",
        duplicates: dups.map((d) => ({ billId: d.bill.id, invoiceNumber: d.bill.invoiceNumber, amountPaise: d.bill.amountPaise, invoiceDate: d.bill.invoiceDate ?? null, reason: d.reason })),
      };
    }
  }
  const { data, error } = await ctx.supabase
    .from("bills")
    .insert({
      workspace_id: ctx.wsId,
      vendor_id: v.vendorId,
      invoice_number: v.invoiceNumber,
      invoice_date: v.invoiceDate ?? null,
      due_date: due,
      amount_paise: v.amountPaise,
      gstin: v.gstin ?? null,
      notes: v.notes ?? null,
      source: v.source,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "bill.created", { type: "bill", id: data.id }, { invoice: v.invoiceNumber, amount_paise: v.amountPaise, vendor: vendor.display_name });
  revalidateBills();
  return { ok: true, data: { id: data.id } };
}

export async function updateBill(billId: string, input: BillInput): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(billId);
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "INVALID", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])) };
  }
  const v = parsed.data;
  const { data: vendor } = await ctx.supabase.from("vendors").select("credit_days").eq("id", v.vendorId).eq("workspace_id", ctx.wsId).maybeSingle();
  if (!vendor) return { ok: false, error: "INVALID" };
  const due = computeDueDate({ printedDueDate: v.dueDate, invoiceDate: v.invoiceDate, creditDays: vendor.credit_days });
  if (!due) return { ok: false, error: "INVALID", fieldErrors: { dueDate: "needDueOrInvoiceDate" } };
  const { error } = await ctx.supabase
    .from("bills")
    .update({
      vendor_id: v.vendorId,
      invoice_number: v.invoiceNumber,
      invoice_date: v.invoiceDate ?? null,
      due_date: due,
      amount_paise: v.amountPaise,
      gstin: v.gstin ?? null,
      notes: v.notes ?? null,
    })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .in("status", ["due", "on_hold"]);
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "bill.updated", { type: "bill", id });
  revalidateBills();
  return { ok: true };
}

export async function setBillHold(billId: string, hold: boolean, reason?: string): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(billId);
  const { error } = await ctx.supabase
    .from("bills")
    .update({ status: hold ? "on_hold" : "due", hold_reason: hold ? (reason?.slice(0, 200) ?? null) : null })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .in("status", hold ? ["due"] : ["on_hold"]);
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, hold ? "bill.held" : "bill.unheld", { type: "bill", id });
  revalidateBills();
  return { ok: true };
}

/** Manual "paid" always needs a UTR/reference — never automatic. */
export async function markBillPaid(billId: string, reference: string): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(billId);
  const ref = z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9\-/ ]+$/).safeParse(reference);
  if (!ref.success) return { ok: false, error: "INVALID", fieldErrors: { reference: "referenceRequired" } };
  const { data: bill } = await ctx.supabase.from("bills").select("amount_paise").eq("id", id).eq("workspace_id", ctx.wsId).maybeSingle();
  if (!bill) return { ok: false, error: "NOT_FOUND" };
  const { error } = await ctx.supabase
    .from("bills")
    .update({ status: "paid", paid_paise: bill.amount_paise, paid_reference: ref.data, paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .in("status", ["due", "on_hold"]);
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "bill.marked_paid", { type: "bill", id }, { reference: ref.data });
  revalidateBills();
  return { ok: true };
}

export async function deleteBill(billId: string): Promise<Result> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(billId);
  const { error } = await ctx.supabase
    .from("bills")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .neq("status", "paid");
  if (error) return { ok: false, error: "DB" };
  await logActivity(ctx, ctx.wsId, "bill.deleted", { type: "bill", id });
  revalidateBills();
  return { ok: true };
}

const importRowSchema = z.object({
  vendorId: z.uuid().nullable(),
  newVendorName: z.string().trim().min(1).max(120).nullable(),
  gstin: z.string().max(15).nullable(),
  invoiceNumber: z.string().trim().min(1).max(60),
  invoiceDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  amountPaise: z.number().int().positive(),
});

/** Imports confirmed rows. New vendors are created without bank details (status "new"). */
export async function importBills(input: { rows: z.input<typeof importRowSchema>[]; preset?: { name: string; mapping: Record<string, string | undefined> } }): Promise<Result<{ count: number }>> {
  const ctx = await requireOwner();
  const rows = z.array(importRowSchema).min(1).max(2000).parse(input.rows);
  const newNames = [...new Set(rows.filter((r) => !r.vendorId && r.newVendorName).map((r) => r.newVendorName!))];
  const nameToId = new Map<string, string>();
  if (newNames.length) {
    const { data: created, error } = await ctx.supabase
      .from("vendors")
      .insert(newNames.map((n) => ({ workspace_id: ctx.wsId, display_name: n })))
      .select("id, display_name");
    if (error) return { ok: false, error: "DB" };
    for (const v of created ?? []) nameToId.set(v.display_name, v.id);
    for (const v of created ?? []) await logActivity(ctx, ctx.wsId, "vendor.created", { type: "vendor", id: v.id }, { name: v.display_name, source: "import" });
  }
  const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter(Boolean) as string[])];
  const { data: vendors } = await ctx.supabase.from("vendors").select("id, credit_days").eq("workspace_id", ctx.wsId).in("id", vendorIds.length ? vendorIds : ["00000000-0000-0000-0000-000000000000"]);
  const credit = new Map((vendors ?? []).map((v) => [v.id, v.credit_days]));
  const inserts = rows.flatMap((r) => {
    const vendorId = r.vendorId ?? (r.newVendorName ? nameToId.get(r.newVendorName) : undefined);
    if (!vendorId) return [];
    const due = computeDueDate({ printedDueDate: r.dueDate, invoiceDate: r.invoiceDate, creditDays: credit.get(vendorId) ?? 30 });
    if (!due) return [];
    return [{
      workspace_id: ctx.wsId,
      vendor_id: vendorId,
      invoice_number: r.invoiceNumber,
      invoice_date: r.invoiceDate,
      due_date: due,
      amount_paise: r.amountPaise,
      paid_paise: 0,
      gstin: r.gstin,
      source: "import" as const,
    }];
  });
  if (!inserts.length) return { ok: false, error: "NOTHING" };
  const { error } = await ctx.supabase.from("bills").insert(inserts, { defaultToNull: false });
  if (error) return { ok: false, error: "DB" };
  if (input.preset?.name) {
    const preset = ImportPresetSchema.safeParse(input.preset);
    if (preset.success) {
      await ctx.supabase
        .from("import_presets")
        .upsert({ workspace_id: ctx.wsId, name: preset.data.name, mapping: preset.data.mapping as Json }, { onConflict: "workspace_id,name" });
    }
  }
  await logActivity(ctx, ctx.wsId, "bill.imported", undefined, { count: inserts.length });
  revalidateBills();
  return { ok: true, data: { count: inserts.length } };
}
