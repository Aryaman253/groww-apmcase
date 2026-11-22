import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { loadPlanningData } from "@/lib/server/runs";
import { PageHeader } from "@/components/app/page-header";
import { RunStatusBadge } from "@/components/app/run-status";
import { RunWizard } from "@/components/pay/wizard";
import { RunView, type RunPaymentView } from "@/components/pay/run-view";
import type { DraftState } from "../actions";
import { addDays, todayIst } from "@/lib/dates";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("pay");
  const { data: run } = await ctx.supabase.from("payment_runs").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!run) notFound();
  const header = (
    <PageHeader
      title={t("runTitle", { number: run.run_number })}
      backHref="/pay"
      backLabel={t("title")}
      action={<RunStatusBadge status={run.status} />}
    />
  );

  if (run.status === "draft") {
    const plan = await loadPlanningData(ctx);
    const raw = (run.draft_state ?? {}) as Partial<DraftState>;
    const initial: DraftState = {
      step: raw.step ?? "select",
      upToDate: raw.upToDate ?? addDays(todayIst(), 7),
      selectedBillIds: (raw.selectedBillIds ?? []).filter((b) => plan.bills.some((x) => x.id === b)),
      amounts: raw.amounts ?? {},
      methods: raw.methods ?? {},
      debitAccountId: raw.debitAccountId ?? run.debit_account_id ?? plan.debitAccounts.find((d) => d.is_default)?.id ?? plan.debitAccounts[0]?.id ?? null,
      excludedVendorIds: raw.excludedVendorIds ?? [],
    };
    return (
      <>
        {header}
        <RunWizard
          runId={run.id}
          runNumber={run.run_number}
          initial={initial}
          bills={plan.bills}
          vendors={plan.vendors}
          history={plan.history}
          newPayeeVendorIds={plan.newPayeeVendorIds}
          debitAccounts={plan.debitAccounts}
          directPayAvailable={plan.directPayAvailable}
          hold24h={Boolean(ctx.workspace.settings?.hold24h)}
        />
      </>
    );
  }

  const [{ data: pays }, { data: prov }] = await Promise.all([
    ctx.supabase
      .from("run_payments")
      .select("id, vendor_id, method, status, amount_paise, utr, failure_reason, remarks, vendors(display_name, phone), vendor_bank_details(account_last4, upi_id, verification), run_payment_bills(bills(invoice_number))")
      .eq("run_id", id)
      .order("created_at"),
    ctx.supabase.from("payout_providers").select("provider, status").eq("workspace_id", ctx.workspace.id).maybeSingle(),
  ]);
  const payments: RunPaymentView[] = (pays ?? []).map((p) => ({
    id: p.id,
    vendorId: p.vendor_id,
    vendorName: p.vendors?.display_name ?? "",
    phone: p.vendors?.phone ?? null,
    method: p.method as RunPaymentView["method"],
    status: p.status as RunPaymentView["status"],
    amountPaise: p.amount_paise,
    utr: p.utr,
    failureReason: p.failure_reason,
    last4: p.vendor_bank_details?.account_last4 ?? null,
    upiId: p.vendor_bank_details?.upi_id ?? null,
    invoiceNumbers: (p.run_payment_bills ?? []).map((b) => b.bills?.invoice_number ?? "").filter(Boolean),
    remarks: p.remarks,
    verification: (p.vendor_bank_details?.verification ?? null) as RunPaymentView["verification"],
  }));
  return (
    <>
      {header}
      <RunView
        runId={run.id}
        runNumber={run.run_number}
        runStatus={run.status}
        payments={payments}
        businessName={ctx.workspace.name}
        provider={prov?.provider ?? null}
        directPayAvailable={prov?.status === "connected"}
      />
    </>
  );
}
