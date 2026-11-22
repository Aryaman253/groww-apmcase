import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/app/money";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("search");
  const { q: raw } = await searchParams;
  const q = (raw ?? "").trim().slice(0, 60);
  const like = `%${q.replace(/[%_,()]/g, " ")}%`;
  const ok = q.length >= 2;
  const [vendors, bills, pays] = ok
    ? await Promise.all([
        ctx.supabase.from("vendors").select("id, display_name, gstin").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).or(`display_name.ilike.${like},gstin.ilike.${like},legal_name.ilike.${like}`).limit(10),
        ctx.supabase.from("bills").select("id, invoice_number, amount_paise, vendors(display_name)").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).ilike("invoice_number", like).limit(10),
        ctx.supabase.from("run_payments").select("id, run_id, utr, amount_paise, vendors(display_name)").eq("workspace_id", ctx.workspace.id).ilike("utr", like).limit(10),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const empty = ok && !vendors.data?.length && !bills.data?.length && !pays.data?.length;
  return (
    <>
      <PageHeader title={t("title")} />
      <form method="get" role="search" className="relative mb-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" aria-hidden />
        <input name="q" type="search" defaultValue={q} autoFocus placeholder={t("placeholder")} aria-label={t("placeholder")} className="h-12 w-full rounded-lg border bg-background pr-3 pl-9" data-testid="search-input" />
      </form>
      {!ok ? <p className="text-text-secondary">{t("hint")}</p> : null}
      {empty ? <p className="text-text-secondary">{t("none", { q })}</p> : null}
      {vendors.data?.length ? (
        <section className="mb-6"><h2 className="mb-2 text-sm font-semibold text-text-secondary uppercase">{t("vendors")}</h2>
          <ul className="flex flex-col gap-1.5">{vendors.data.map((v) => <li key={v.id}><Link href={`/vendors/${v.id}`} className="flex min-h-12 items-center justify-between rounded-lg border bg-card px-3 hover:bg-surface-hover"><span>{v.display_name}</span><span className="text-xs text-text-secondary">{v.gstin}</span></Link></li>)}</ul>
        </section>
      ) : null}
      {bills.data?.length ? (
        <section className="mb-6"><h2 className="mb-2 text-sm font-semibold text-text-secondary uppercase">{t("bills")}</h2>
          <ul className="flex flex-col gap-1.5">{bills.data.map((b) => <li key={b.id}><Link href={`/bills/${b.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border bg-card px-3 hover:bg-surface-hover"><span className="truncate">{b.invoice_number} · {b.vendors?.display_name}</span><Money paise={b.amount_paise} className="text-sm" /></Link></li>)}</ul>
        </section>
      ) : null}
      {pays.data?.length ? (
        <section><h2 className="mb-2 text-sm font-semibold text-text-secondary uppercase">{t("payments")}</h2>
          <ul className="flex flex-col gap-1.5">{pays.data.map((p) => <li key={p.id}><Link href={`/pay/${p.run_id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border bg-card px-3 hover:bg-surface-hover"><span className="tabular truncate">{p.utr} · {p.vendors?.display_name}</span><Money paise={p.amount_paise} className="text-sm" /></Link></li>)}</ul>
        </section>
      ) : null}
    </>
  );
}
