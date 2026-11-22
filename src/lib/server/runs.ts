import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AppContext } from "./context";
import type { BankDetailsVersion, PaymentHistoryEntry, PaymentVendor, RunPaymentStatus } from "@/lib/payments";
import { runStatusFromPayments } from "@/lib/payments";
import { isDirectPayEnabled } from "@/lib/rails/config";

type DB = SupabaseClient<Database>;

export type PlanVendor = PaymentVendor & {
  phone: string | null;
  upiId: string | null;
  last4: string | null;
  ifsc: string | null;
  bankDetailId: string | null;
  holderName: string | null;
};

export type PlanBill = {
  id: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string;
  amountPaise: number; // outstanding
};

/** Everything the wizard needs to plan a run (no full account numbers). */
export async function loadPlanningData(ctx: AppContext) {
  const ws = ctx.workspace.id;
  const [{ data: bills }, { data: vendors }, { data: details }, { data: history }, { data: debit }, { data: provider }] = await Promise.all([
    ctx.supabase
      .from("bills")
      .select("id, vendor_id, invoice_number, invoice_date, due_date, amount_paise, paid_paise")
      .eq("workspace_id", ws)
      .is("deleted_at", null)
      .eq("status", "due")
      .order("due_date"),
    ctx.supabase.from("vendors").select("id, display_name, status, gstin, credit_days, phone").eq("workspace_id", ws).is("deleted_at", null),
    ctx.supabase
      .from("vendor_bank_details")
      .select("id, vendor_id, version, status, account_last4, ifsc, upi_id, approved_at, account_holder_name")
      .eq("workspace_id", ws),
    ctx.supabase
      .from("run_payments")
      .select("vendor_id, amount_paise, status, sent_at, created_at, bank_detail_id, run_payment_bills(bill_id)")
      .eq("workspace_id", ws)
      .in("status", ["paid", "sent", "processing"]),
    ctx.supabase.from("debit_accounts").select("id, bank_name, nickname, account_last4, ifsc, is_default, bank_template_id").eq("workspace_id", ws).is("deleted_at", null).order("created_at"),
    ctx.supabase.from("payout_providers").select("provider, status").eq("workspace_id", ws).maybeSingle(),
  ]);
  const det = details ?? [];
  const planVendors: PlanVendor[] = (vendors ?? []).map((v) => {
    const versions: BankDetailsVersion[] = det
      .filter((d) => d.vendor_id === v.id)
      .map((d) => ({
        version: d.version,
        status: d.status as BankDetailsVersion["status"],
        accountLast4: d.account_last4,
        ifsc: d.ifsc,
        upiId: d.upi_id,
        approvedAt: d.approved_at,
      }));
    const approved = det.find((d) => d.vendor_id === v.id && d.status === "approved");
    return {
      id: v.id,
      name: v.display_name,
      status: v.status,
      gstin: v.gstin,
      creditDays: v.credit_days,
      bankDetails: versions,
      phone: v.phone,
      upiId: approved?.upi_id ?? null,
      last4: approved?.account_last4 ?? null,
      ifsc: approved?.ifsc ?? null,
      bankDetailId: approved?.id ?? null,
      holderName: approved?.account_holder_name ?? null,
    };
  });
  const hist: PaymentHistoryEntry[] = (history ?? []).map((h) => ({
    vendorId: h.vendor_id,
    amountPaise: h.amount_paise,
    date: (h.sent_at ?? h.created_at).slice(0, 10),
    status: h.status as RunPaymentStatus,
    billIds: (h.run_payment_bills ?? []).map((b) => b.bill_id),
  }));
  // A vendor is a "new payee" when their currently approved details were never paid before.
  const paidDetailIds = new Set((history ?? []).map((h) => h.bank_detail_id).filter(Boolean) as string[]);
  const newPayeeVendorIds = planVendors.filter((v) => v.bankDetailId && !paidDetailIds.has(v.bankDetailId)).map((v) => v.id);
  return {
    bills: (bills ?? []).map<PlanBill>((b) => ({
      id: b.id,
      vendorId: b.vendor_id,
      invoiceNumber: b.invoice_number,
      invoiceDate: b.invoice_date,
      dueDate: b.due_date,
      amountPaise: b.amount_paise - b.paid_paise,
    })),
    vendors: planVendors,
    history: hist,
    newPayeeVendorIds,
    debitAccounts: debit ?? [],
    directPayAvailable: isDirectPayEnabled() && provider?.status === "connected",
    provider: provider?.provider ?? null,
  };
}

export type Outcome =
  | { kind: "sent" }
  | { kind: "processing"; providerStatus?: string }
  | { kind: "paid"; utr: string }
  | { kind: "failed"; reason: string }
  | { kind: "reversed"; reason: string }
  | { kind: "skipped" };

/**
 * Applies a payment outcome and its effect on bills, then recomputes the run status.
 * Shared by owner actions (user client, RLS) and provider webhooks (service client).
 * Idempotent: re-applying the same terminal outcome is a no-op.
 */
export async function applyPaymentOutcome(db: DB, paymentId: string, outcome: Outcome) {
  const { data: p } = await db
    .from("run_payments")
    .select("id, run_id, status, workspace_id, utr, run_payment_bills(bill_id, amount_paise)")
    .eq("id", paymentId)
    .maybeSingle();
  if (!p) throw new Error("PAYMENT_NOT_FOUND");
  const now = new Date().toISOString();
  const allocs = p.run_payment_bills ?? [];
  const prev = p.status;

  if (outcome.kind === "sent") {
    if (prev !== "pending") return { changed: false };
    await db.from("run_payments").update({ status: "sent", sent_at: now }).eq("id", p.id).eq("status", "pending");
  } else if (outcome.kind === "processing") {
    if (!["pending", "sent"].includes(prev)) return { changed: false };
    await db
      .from("run_payments")
      .update({ status: "processing", sent_at: now, provider_status: outcome.providerStatus ?? null })
      .eq("id", p.id);
  } else if (outcome.kind === "paid") {
    if (prev === "paid") return { changed: false };
    if (["failed", "reversed", "skipped"].includes(prev)) throw new Error("PAYMENT_ALREADY_RESOLVED");
    await db.from("run_payments").update({ status: "paid", utr: outcome.utr, resolved_at: now, failure_reason: null }).eq("id", p.id);
    for (const a of allocs) {
      const { data: b } = await db.from("bills").select("amount_paise, paid_paise").eq("id", a.bill_id).single();
      if (!b) continue;
      const paid = Math.min(b.amount_paise, b.paid_paise + a.amount_paise);
      await db
        .from("bills")
        .update(
          paid >= b.amount_paise
            ? { paid_paise: paid, status: "paid", paid_reference: outcome.utr, paid_at: now }
            : { paid_paise: paid, status: "due" },
        )
        .eq("id", a.bill_id);
    }
  } else if (outcome.kind === "failed" || outcome.kind === "reversed" || outcome.kind === "skipped") {
    if (prev === outcome.kind) return { changed: false };
    if (outcome.kind !== "reversed" && ["paid", "failed", "reversed", "skipped"].includes(prev)) return { changed: false };
    await db
      .from("run_payments")
      .update({
        status: outcome.kind,
        failure_reason: outcome.kind === "skipped" ? null : outcome.reason,
        resolved_at: now,
      })
      .eq("id", p.id);
    for (const a of allocs) {
      const { data: b } = await db.from("bills").select("amount_paise, paid_paise").eq("id", a.bill_id).single();
      if (!b) continue;
      // A reversal after "paid" takes the money back off the bill.
      const paid = prev === "paid" ? Math.max(0, b.paid_paise - a.amount_paise) : b.paid_paise;
      await db.from("bills").update({ status: "due", paid_paise: paid, paid_reference: null, paid_at: null }).eq("id", a.bill_id);
    }
  }
  await recomputeRunStatus(db, p.run_id);
  return { changed: true };
}

export async function recomputeRunStatus(db: DB, runId: string) {
  const [{ data: run }, { data: pays }] = await Promise.all([
    db.from("payment_runs").select("status").eq("id", runId).single(),
    db.from("run_payments").select("status").eq("run_id", runId),
  ]);
  if (!run || run.status === "draft" || run.status === "cancelled") return;
  const next = runStatusFromPayments((pays ?? []).map((p) => p.status as RunPaymentStatus), { confirmed: true });
  if (next !== run.status) {
    await db
      .from("payment_runs")
      .update({ status: next, completed_at: next === "completed" || next === "partly_failed" ? new Date().toISOString() : null })
      .eq("id", runId);
  }
}
