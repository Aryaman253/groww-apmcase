import { getLocale, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { paidPayments } from "@/lib/server/reports";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { addDays, formatDate, todayIst } from "@/lib/dates";
import { formatInrRounded } from "@/lib/money";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; vendor?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("reports");
  const tm = await getTranslations("more");
  const locale = await getLocale();
  const sp = await searchParams;
  const today = todayIst();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && iso.test(sp.from) ? sp.from : addDays(today, -180);
  const to = sp.to && iso.test(sp.to) ? sp.to : today;
  const vendorId = sp.vendor && /^[0-9a-f-]{36}$/.test(sp.vendor) ? sp.vendor : undefined;
  const [pays, { data: vendors }, { data: dues }] = await Promise.all([
    paidPayments(ctx, { from, to, vendorId }),
    ctx.supabase.from("vendors").select("id, display_name").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("display_name"),
    ctx.supabase.from("bills").select("due_date, amount_paise, paid_paise").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).in("status", ["due", "scheduled"]).lte("due_date", addDays(today, 30)),
  ]);
  const months = new Map<string, number>();
  const byVendor = new Map<string, { name: string; total: number; count: number }>();
  for (const p of pays) {
    const m = (p.resolved_at ?? "").slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + p.amount_paise);
    const v = byVendor.get(p.vendor_id) ?? { name: p.vendors?.display_name ?? "", total: 0, count: 0 };
    v.total += p.amount_paise;
    v.count++;
    byVendor.set(p.vendor_id, v);
  }
  const monthRows = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const max = Math.max(1, ...monthRows.map(([, v]) => v));
  const total = pays.reduce((s, p) => s + p.amount_paise, 0);
  const upcoming = [7, 15, 30].map((d) => ({ d, total: (dues ?? []).filter((b) => b.due_date <= addDays(today, d)).reduce((s, b) => s + b.amount_paise - b.paid_paise, 0) }));
  const monthLabel = (m: string) => new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { month: "short", year: "2-digit" }).format(new Date(`${m}-01T00:00:00`));
  const qs = new URLSearchParams({ from, to, ...(vendorId ? { vendor: vendorId } : {}) }).toString();

  return (
    <>
      <PageHeader title={t("title")} backHref="/more" backLabel={tm("title")} />
      <section className="mb-6 grid grid-cols-3 gap-2">
        {upcoming.map((u) => (
          <div key={u.d} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-text-secondary">{t("next", { days: u.d })}</p>
            <p className="tabular mt-1 font-semibold">{formatInrRounded(u.total)}</p>
          </div>
        ))}
      </section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-text-secondary uppercase">{t("payments")}</h2>
      <form className="mb-4 grid grid-cols-2 gap-2 rounded-xl border bg-card p-3" method="get">
        <label className="space-y-1 text-sm"><span className="text-text-secondary">{t("from")}</span><input type="date" name="from" defaultValue={from} className="h-11 w-full rounded-lg border bg-background px-2" /></label>
        <label className="space-y-1 text-sm"><span className="text-text-secondary">{t("to")}</span><input type="date" name="to" defaultValue={to} className="h-11 w-full rounded-lg border bg-background px-2" /></label>
        <label className="col-span-2 space-y-1 text-sm"><span className="text-text-secondary">{t("vendor")}</span>
          <select name="vendor" defaultValue={vendorId ?? ""} className="h-11 w-full rounded-lg border bg-background px-2">
            <option value="">{t("allVendors")}</option>
            {(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.display_name}</option>)}
          </select>
        </label>
        <Button className="col-span-2 h-11" type="submit">{(await getTranslations("common"))("search")}</Button>
      </form>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-text-secondary">{t("total")}</span>
        <Money paise={total} className="text-xl font-semibold" />
      </div>
      {pays.length === 0 ? <p className="text-text-secondary">{t("noData")}</p> : (
        <>
          <figure className="mb-6 rounded-xl border bg-card p-4" aria-label={t("chartLabel")}>
            <div className="flex h-32 items-end gap-2">
              {monthRows.map(([m, v]) => (
                <div key={m} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-brand/80" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={`${monthLabel(m)}: ${formatInrRounded(v)}`} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-2">{monthRows.map(([m]) => <span key={m} className="flex-1 text-center text-[10px] text-text-secondary">{monthLabel(m)}</span>)}</div>
          </figure>
          <h3 className="mb-2 font-medium">{t("byMonth")}</h3>
          <table className="mb-6 w-full text-sm">
            <tbody>
              {monthRows.map(([m, v]) => (
                <tr key={m} className="border-b"><td className="py-2">{monthLabel(m)}</td><td className="tabular py-2 text-right"><Money paise={v} /></td></tr>
              ))}
            </tbody>
          </table>
          <h3 className="mb-2 font-medium">{t("byVendor")}</h3>
          <ul className="mb-6 flex flex-col gap-1.5">
            {[...byVendor.values()].sort((a, b) => b.total - a.total).map((v) => (
              <li key={v.name} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
                <span className="truncate">{v.name} <span className="text-text-secondary">· {v.count}</span></span>
                <Money paise={v.total} />
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="h-12 w-full">
            <a href={`/api/reports/payments?${qs}`} download><Download className="size-4" aria-hidden /> {t("export")}</a>
          </Button>
        </>
      )}
      <p className="mt-4 text-xs text-text-secondary">{formatDate(from, locale)} – {formatDate(to, locale)}</p>
    </>
  );
}
