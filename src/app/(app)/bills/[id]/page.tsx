import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/app/money";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, todayIst } from "@/lib/dates";
import { BillActions } from "./bill-actions";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("bills");
  const locale = await getLocale();
  const { data: bill } = await ctx.supabase
    .from("bills")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!bill) notFound();
  const [{ data: vendor }, { data: links }] = await Promise.all([
    ctx.supabase.from("vendors").select("id, display_name").eq("id", bill.vendor_id).maybeSingle(),
    ctx.supabase.from("run_payment_bills").select("amount_paise, run_payments(status, utr, run_id, payment_runs(run_number, status))").eq("bill_id", bill.id),
  ]);
  const today = todayIst();
  const tab = bill.status === "due" && bill.due_date < today ? "overdue" : bill.status;
  const tone = tab === "paid" ? "success" : tab === "overdue" ? "danger" : tab === "on_hold" ? "warning" : tab === "scheduled" ? "info" : "neutral";
  const activeRun = (links ?? [])
    .map((l) => l.run_payments)
    .find((rp) => rp && ["pending", "sent", "processing"].includes(rp.status) && rp.payment_runs && rp.payment_runs.status !== "draft");

  const rows: [string, React.ReactNode][] = [
    [t("form.invoiceNumber"), bill.invoice_number],
    [t("form.invoiceDate"), formatDate(bill.invoice_date, locale)],
    [t("form.dueDate"), formatDate(bill.due_date, locale)],
    [t("form.gstin"), bill.gstin ?? "—"],
  ];
  return (
    <>
      <PageHeader title={vendor?.display_name ?? t("detail.title")} backHref="/bills" backLabel={t("title")} />
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-text-secondary">{t("invoice", { number: bill.invoice_number })}</p>
            <Money paise={bill.amount_paise - (bill.status === "paid" ? 0 : bill.paid_paise)} className="text-3xl font-semibold" />
          </div>
          <StatusBadge tone={tone}>{t(`status.${tab}`)}</StatusBadge>
        </div>
        {bill.hold_reason ? <p className="mt-3 text-sm text-warning">{bill.hold_reason}</p> : null}
        {bill.paid_reference ? <p className="mt-3 text-sm text-text-secondary">UTR / Ref: <span className="tabular">{bill.paid_reference}</span></p> : null}
        <dl className="mt-4 divide-y text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="tabular text-right">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-2.5">
            <dt className="text-text-secondary">{t("detail.title")}</dt>
            <dd>{t(`detail.source.${bill.source}`)}</dd>
          </div>
        </dl>
        {bill.notes ? <p className="mt-3 text-sm whitespace-pre-wrap">{bill.notes}</p> : null}
        {vendor ? (
          <Link href={`/vendors/${vendor.id}`} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">
            {t("detail.viewVendor")}
          </Link>
        ) : null}
      </section>
      {activeRun?.payment_runs ? (
        <p className="mt-4 rounded-lg bg-info-bg px-3 py-2 text-sm text-info">
          <Link href={`/pay/${activeRun.run_id}`}>{t("actions.inRun", { number: activeRun.payment_runs.run_number })}</Link>
        </p>
      ) : null}
      <BillActions billId={bill.id} status={bill.status} locked={Boolean(activeRun)} />
    </>
  );
}
