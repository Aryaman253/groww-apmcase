import { notFound } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ShieldAlert, Download } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { listVendors } from "@/lib/server/vendors";
import { PageHeader } from "@/components/app/page-header";
import { VendorStatusBadge } from "@/components/app/vendor-status";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate, todayIst } from "@/lib/dates";
import { maskAccount } from "@/lib/validation";
import { RequestLinkSheet } from "@/components/vendors/request-link";
import { VendorDangerZone } from "./danger-zone";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("vendors");
  const tb = await getTranslations("bills");
  const locale = await getLocale();
  const [vendor] = await listVendors(ctx, { ids: [id] });
  if (!vendor) notFound();
  const [{ data: bills }, { data: payments }] = await Promise.all([
    ctx.supabase.from("bills").select("id, invoice_number, due_date, amount_paise, paid_paise, status, paid_at").eq("vendor_id", id).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("due_date", { ascending: false }).limit(50),
    ctx.supabase
      .from("run_payments")
      .select("id, amount_paise, status, utr, method, resolved_at, created_at, run_id, payment_runs(run_number)")
      .eq("vendor_id", id)
      .eq("workspace_id", ctx.workspace.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const today = todayIst();
  const bank = vendor.approved;
  const rows: [string, string | null | undefined][] = [
    [t("form.accountHolderName"), bank?.account_holder_name],
    [t("form.accountNumber"), bank?.account_last4 ? maskAccount(bank.account_last4) : null],
    [t("form.ifsc"), bank?.ifsc],
    [t("form.bankBranch"), [bank?.bank_name, bank?.branch].filter(Boolean).join(" · ") || null],
    [t("form.upiId"), bank?.upi_id],
  ];
  const profile: [string, string | number | null | undefined][] = [
    [t("form.legalName"), vendor.legal_name],
    [t("form.gstin"), vendor.gstin],
    [t("form.phone"), vendor.phone],
    [t("form.email"), vendor.email],
    [t("form.creditDays"), vendor.credit_days],
  ];

  return (
    <>
      <PageHeader title={vendor.display_name} backHref="/vendors" backLabel={t("title")} />
      <div className="-mt-2 mb-4 flex items-center gap-3">
        <VendorStatusBadge status={vendor.displayStatus} />
        {vendor.dueTotalPaise > 0 ? (
          <span className="text-sm text-text-secondary">
            {t("due")} <Money paise={vendor.dueTotalPaise} className="font-medium text-foreground" />
          </span>
        ) : null}
      </div>

      {vendor.pending ? (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-warning/50 bg-warning-bg p-4" data-testid="pending-review">
          <p className="flex items-start gap-2 text-sm text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t("detail.pendingReview")} {vendor.approved ? t("detail.blocked") : null}
            </span>
          </p>
          <Button asChild className="h-11">
            <Link href={`/vendors/${id}/review`}>{t("detail.review")}</Link>
          </Button>
        </div>
      ) : null}

      <section className="mb-6 rounded-2xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t("detail.bankDetails")}</h2>
          {bank ? <span className="text-xs text-text-secondary">{bank.approved_at ? t("detail.approvedOn", { date: formatDate(bank.approved_at.slice(0, 10), locale) }) : null}</span> : null}
        </div>
        {bank ? (
          <dl className="divide-y text-sm">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-text-secondary">{k}</dt>
                <dd className="tabular text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-text-secondary">{t("noBank")}</p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <Button asChild variant="outline" className="h-11">
            <Link href={`/vendors/${id}/bank`}>{bank || vendor.pending ? t("detail.changeBank") : t("detail.addBank")}</Link>
          </Button>
          <RequestLinkSheet
            vendorId={id}
            phone={vendor.phone}
            businessName={ctx.workspace.name}
            trigger={
              <Button variant="ghost" className="h-11">
                {t("methodRequest")}
              </Button>
            }
          />
        </div>
      </section>

      <section className="mb-6 rounded-2xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t("detail.details")}</h2>
          <Link href={`/vendors/${id}/edit`} className="min-h-11 content-center text-sm font-medium">
            {t("detail.editProfile")}
          </Link>
        </div>
        <dl className="divide-y text-sm">
          {profile.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="tabular text-right break-all">{v}</dd>
            </div>
          ))}
        </dl>
        {vendor.notes ? <p className="mt-2 text-sm whitespace-pre-wrap text-text-secondary">{vendor.notes}</p> : null}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">{t("detail.bills")}</h2>
        {bills?.length ? (
          <ul className="flex flex-col gap-2">
            {bills.map((b) => {
              const tab = b.status === "due" && b.due_date < today ? "overdue" : b.status;
              return (
                <li key={b.id}>
                  <Link href={`/bills/${b.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 hover:bg-surface-hover">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{b.invoice_number}</span>
                      <span className="block text-xs text-text-secondary">{tb("dueOn", { date: formatDate(b.due_date, locale) })}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Money paise={b.amount_paise} className="text-sm" />
                      <StatusBadge tone={tab === "paid" ? "success" : tab === "overdue" ? "danger" : tab === "on_hold" ? "warning" : "neutral"}>{tb(`status.${tab}`)}</StatusBadge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">{t("detail.noBills")}</p>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t("detail.history")}</h2>
          <Button asChild variant="ghost" className="h-11">
            <a href={`/api/vendors/${id}/statement`} download>
              <Download className="size-4" aria-hidden /> {t("detail.statement")}
            </a>
          </Button>
        </div>
        {payments?.length ? (
          <ul className="flex flex-col gap-2">
            {payments.map((p) => (
              <li key={p.id}>
                <Link href={`/pay/${p.run_id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 hover:bg-surface-hover">
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">#{p.payment_runs?.run_number} · {formatDate((p.resolved_at ?? p.created_at).slice(0, 10), locale)}</span>
                    <span className="block truncate text-xs text-text-secondary tabular">{p.utr ?? "—"}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Money paise={p.amount_paise} className="text-sm" />
                    <StatusBadge tone={p.status === "paid" ? "success" : p.status === "failed" || p.status === "reversed" ? "danger" : "info"}>{p.status}</StatusBadge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">{t("detail.noPayments")}</p>
        )}
      </section>
      <VendorDangerZone vendorId={id} />
    </>
  );
}
