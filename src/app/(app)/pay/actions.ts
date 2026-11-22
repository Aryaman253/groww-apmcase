"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAppContext, requireOwner } from "@/lib/server/context";
import { logActivity } from "@/lib/server/activity";
import { applyPaymentOutcome, loadPlanningData, type Outcome } from "@/lib/server/runs";
import { groupBillsIntoPayments, paymentWarnings, runTotals, suggestMethod, type PaymentMethod } from "@/lib/payments";
import { addDays, todayIst } from "@/lib/dates";
import type { Json } from "@/lib/supabase/database.types";

export type DraftState = {
  step: "select" | "review" | "confirm";
  upToDate: string;
  selectedBillIds: string[];
  amounts: Record<string, number>;
  methods: Record<string, PaymentMethod>;
  debitAccountId: string | null;
  excludedVendorIds?: string[];
};

const draftSchema = z.object({
  step: z.enum(["select", "review", "confirm"]),
  upToDate: z.iso.date(),
  selectedBillIds: z.array(z.uuid()).max(2000),
  amounts: z.record(z.uuid(), z.number().int().positive()),
  methods: z.record(z.uuid(), z.enum(["direct", "bank_file", "upi"])),
  debitAccountId: z.uuid().nullable(),
  excludedVendorIds: z.array(z.uuid()).optional(),
});

function revalidateRun(id?: string) {
  revalidatePath("/pay");
  revalidatePath("/home");
  revalidatePath("/bills");
  if (id) revalidatePath(`/pay/${id}`);
}

export async function createDraftRun() {
  const ctx = await requireOwner();
  const { data: existing } = await ctx.supabase
    .from("payment_runs")
    .select("id")
    .eq("workspace_id", ctx.wsId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing?.[0]) redirect(`/pay/${existing[0].id}`);
  const plan = await loadPlanningData(ctx);
  const upTo = addDays(todayIst(), 7);
  const def = plan.debitAccounts.find((d) => d.is_default) ?? plan.debitAccounts[0];
  const state: DraftState = {
    step: "select",
    upToDate: upTo,
    selectedBillIds: plan.bills.filter((b) => b.dueDate <= upTo).map((b) => b.id),
    amounts: {},
    methods: {},
    debitAccountId: def?.id ?? null,
  };
  const { data, error } = await ctx.supabase
    .from("payment_runs")
    .insert({ workspace_id: ctx.wsId, run_number: 0, up_to_date: upTo, debit_account_id: def?.id ?? null, draft_state: state as unknown as Json })
    .select("id")
    .single();
  if (error || !data) throw new Error("DB");
  await logActivity(ctx, ctx.wsId, "run.created", { type: "run", id: data.id });
  redirect(`/pay/${data.id}`);
}

export async function saveDraft(runId: string, state: DraftState) {
  const ctx = await requireOwner();
  const id = z.uuid().parse(runId);
  const s = draftSchema.parse(state);
  await ctx.supabase
    .from("payment_runs")
    .update({ draft_state: s as unknown as Json, up_to_date: s.upToDate, debit_account_id: s.debitAccountId })
    .eq("id", id)
    .eq("workspace_id", ctx.wsId)
    .eq("status", "draft");
  return { ok: true };
}

export async function discardDraft(runId: string) {
  const ctx = await requireOwner();
  const id = z.uuid().parse(runId);
  await ctx.supabase.from("payment_runs").update({ status: "cancelled", deleted_at: new Date().toISOString() }).eq("id", id).eq("workspace_id", ctx.wsId).eq("status", "draft");
  revalidateRun();
  redirect("/pay");
}

/**
 * Confirms a draft: recomputes everything server-side (never trusts client totals),
 * blocks unpayable vendors, and creates one payment per vendor with bill allocations.
 */
export async function confirmRun(runId: string, state: DraftState, expectedTotalPaise: number): Promise<{ ok: true } | { ok: false; error: string; vendors?: string[] }> {
  const ctx = await requireOwner();
  const id = z.uuid().parse(runId);
  const s = draftSchema.parse(state);
  const { data: run } = await ctx.supabase.from("payment_runs").select("id, status, run_number").eq("id", id).eq("workspace_id", ctx.wsId).maybeSingle();
  if (!run || run.status !== "draft") return { ok: false, error: "NOT_DRAFT" };
  if (!s.debitAccountId) return { ok: false, error: "NO_DEBIT_ACCOUNT" };

  const plan = await loadPlanningData(ctx);
  const selected = new Set(s.selectedBillIds);
  const excluded = new Set(s.excludedVendorIds ?? []);
  const bills = plan.bills.filter((b) => selected.has(b.id) && !excluded.has(b.vendorId));
  const proposals = groupBillsIntoPayments(bills, plan.vendors, { amounts: s.amounts });
  const hold = { enabled: Boolean(ctx.workspace.settings?.hold24h) };
  const blocked: string[] = [];
  const toCreate = proposals.filter((p) => {
    const v = plan.vendors.find((x) => x.id === p.vendorId)!;
    const w = paymentWarnings(v, { amountPaise: p.amountPaise, billIds: p.allocations.map((a) => a.billId) }, plan.history, { hold });
    if (w.excluded) return false; // missing details → excluded until fixed
    if (w.blocking || p.error) {
      blocked.push(v.name);
      return false;
    }
    return true;
  });
  if (blocked.length) return { ok: false, error: "BLOCKED", vendors: blocked };
  if (!toCreate.length) return { ok: false, error: "EMPTY" };
  const totals = runTotals(toCreate);
  if (totals.totalPaise !== expectedTotalPaise) return { ok: false, error: "TOTAL_CHANGED" };

  const payments = toCreate.map((p) => {
    const v = plan.vendors.find((x) => x.id === p.vendorId)!;
    let method: PaymentMethod | null = s.methods[p.vendorId] ?? suggestMethod(v, { directPayAvailable: plan.directPayAvailable });
    if (method === "direct" && !plan.directPayAvailable) method = suggestMethod(v, { directPayAvailable: false });
    if (method === "bank_file" && !v.last4) method = v.upiId ? "upi" : null;
    if (method === "upi" && !v.upiId) method = v.last4 ? "bank_file" : null;
    return {
      id: crypto.randomUUID(),
      workspace_id: ctx.wsId,
      run_id: id,
      vendor_id: p.vendorId,
      bank_detail_id: v.bankDetailId,
      amount_paise: p.amountPaise,
      method: method ?? "bank_file",
      remarks: p.remarks,
      warnings: paymentWarnings(v, { amountPaise: p.amountPaise, billIds: p.allocations.map((a) => a.billId) }, plan.history, { hold }).warnings as unknown as Json,
      _alloc: p.allocations,
    };
  });
  const { error: pErr } = await ctx.supabase.from("run_payments").insert(payments.map(({ _alloc, ...p }) => { void _alloc; return p; }));
  if (pErr) return { ok: false, error: pErr.message.includes("not payable") ? "BLOCKED" : "DB" };
  const links = payments.flatMap((p) => p._alloc.map((a) => ({ workspace_id: ctx.wsId, run_payment_id: p.id, bill_id: a.billId, amount_paise: a.amountPaise })));
  const { error: lErr } = await ctx.supabase.from("run_payment_bills").insert(links);
  if (lErr) return { ok: false, error: "DB" };
  await ctx.supabase.from("bills").update({ status: "scheduled" }).in("id", links.map((l) => l.bill_id)).eq("workspace_id", ctx.wsId);
  await ctx.supabase
    .from("payment_runs")
    .update({
      status: "confirmed",
      total_paise: totals.totalPaise,
      payment_count: totals.count,
      debit_account_id: s.debitAccountId,
      confirmed_at: new Date().toISOString(),
      confirmed_by: ctx.user.id,
      draft_state: s as unknown as Json,
    })
    .eq("id", id);
  await logActivity(ctx, ctx.wsId, "run.confirmed", { type: "run", id }, { run_number: run.run_number, total_paise: totals.totalPaise, count: totals.count });
  revalidateRun(id);
  return { ok: true };
}

async function ownPayment(paymentId: string) {
  const ctx = await requireOwner();
  const id = z.uuid().parse(paymentId);
  const { data } = await ctx.supabase.from("run_payments").select("id, run_id, vendor_id, amount_paise").eq("id", id).eq("workspace_id", ctx.wsId).maybeSingle();
  if (!data) throw new Error("NOT_FOUND");
  return { ctx, p: data };
}

export async function markPaymentsSent(paymentIds: string[]) {
  let runId: string | undefined;
  for (const pid of paymentIds.slice(0, 500)) {
    const { ctx, p } = await ownPayment(pid);
    const r = await applyPaymentOutcome(ctx.supabase, p.id, { kind: "sent" });
    if (r.changed) await logActivity(ctx, ctx.wsId, "payment.marked_sent", { type: "run_payment", id: p.id });
    runId = p.run_id;
  }
  revalidateRun(runId);
  return { ok: true };
}

const utrSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9\-/]{6,40}$/);

/** "Paid" always needs a UTR/reference. */
export async function recordUtr(paymentId: string, utr: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = utrSchema.safeParse(utr);
  if (!parsed.success) return { ok: false, error: "UTR" };
  const { ctx, p } = await ownPayment(paymentId);
  try {
    await applyPaymentOutcome(ctx.supabase, p.id, { kind: "paid", utr: parsed.data });
  } catch {
    return { ok: false, error: "RESOLVED" };
  }
  await logActivity(ctx, ctx.wsId, "utr.recorded", { type: "run_payment", id: p.id }, { utr: parsed.data, amount_paise: p.amount_paise });
  revalidateRun(p.run_id);
  return { ok: true };
}

export async function markPaymentFailed(paymentId: string, reason: string) {
  const { ctx, p } = await ownPayment(paymentId);
  const r = z.string().trim().min(2).max(200).parse(reason);
  await applyPaymentOutcome(ctx.supabase, p.id, { kind: "failed", reason: r });
  await logActivity(ctx, ctx.wsId, "payment.failed", { type: "run_payment", id: p.id }, { reason: r });
  revalidateRun(p.run_id);
  return { ok: true };
}

export async function skipPayment(paymentId: string) {
  const { ctx, p } = await ownPayment(paymentId);
  await applyPaymentOutcome(ctx.supabase, p.id, { kind: "skipped" });
  revalidateRun(p.run_id);
  return { ok: true };
}

const resultSchema = z.array(
  z.object({
    paymentId: z.uuid(),
    status: z.enum(["success", "failed"]),
    utr: z.string().nullable(),
    reason: z.string().max(200).nullable(),
  }),
);

/** Results confirmed by the owner after uploading the bank's status file. */
export async function applyStatusResults(runId: string, results: z.input<typeof resultSchema>) {
  const ctx = await requireOwner();
  const id = z.uuid().parse(runId);
  const rows = resultSchema.parse(results);
  const { data: pays } = await ctx.supabase.from("run_payments").select("id").eq("run_id", id).eq("workspace_id", ctx.wsId);
  const own = new Set((pays ?? []).map((p) => p.id));
  let applied = 0;
  const skipped: string[] = [];
  for (const r of rows) {
    if (!own.has(r.paymentId)) continue;
    let outcome: Outcome;
    if (r.status === "success") {
      const u = utrSchema.safeParse(r.utr ?? "");
      if (!u.success) {
        skipped.push(r.paymentId); // success without a UTR → owner must enter one
        continue;
      }
      outcome = { kind: "paid", utr: u.data };
    } else outcome = { kind: "failed", reason: r.reason || "Failed at bank" };
    try {
      const res = await applyPaymentOutcome(ctx.supabase, r.paymentId, outcome);
      if (res.changed) {
        applied++;
        await logActivity(ctx, ctx.wsId, outcome.kind === "paid" ? "utr.recorded" : "payment.failed", { type: "run_payment", id: r.paymentId }, outcome.kind === "paid" ? { utr: outcome.utr, source: "status_file" } : { reason: outcome.reason, source: "status_file" });
      }
    } catch {
      skipped.push(r.paymentId);
    }
  }
  revalidateRun(id);
  return { ok: true, applied, skipped };
}

export async function logFileDownload(runId: string) {
  const ctx = await getAppContext();
  await logActivity(ctx, ctx.workspace.id, "run.file_downloaded", { type: "run", id: z.uuid().parse(runId) });
}
