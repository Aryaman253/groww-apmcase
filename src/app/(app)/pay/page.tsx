import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Send } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { RunStatusBadge } from "@/components/app/run-status";
import { Money } from "@/components/app/money";
import { formatDate } from "@/lib/dates";
import { StartRunButton } from "./start-run-button";

export const metadata = { title: "Pay" };

export default async function PayPage() {
  const ctx = await getAppContext();
  const t = await getTranslations("pay");
  const th = await getTranslations("home");
  const locale = await getLocale();
  const { data: runs } = await ctx.supabase
    .from("payment_runs")
    .select("id, run_number, status, total_paise, payment_count, created_at, confirmed_at")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  const draft = runs?.find((r) => r.status === "draft");
  return (
    <>
      <PageHeader title={t("title")} description={t("startBody")} />
      <div className="mb-6">{draft ? (
        <Link href={`/pay/${draft.id}`} className="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-medium text-primary-foreground">
          {th("continueDraft")}
        </Link>
      ) : (
        <StartRunButton label={t("start")} />
      )}</div>
      {runs?.length ? (
        <ul className="flex flex-col gap-2" data-testid="run-list">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/pay/${r.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-surface-hover">
                <div className="flex-1 space-y-1">
                  <p className="font-medium">{t("runTitle", { number: r.run_number })}</p>
                  <p className="text-sm text-text-secondary">{th("runMeta", { date: formatDate((r.confirmed_at ?? r.created_at).slice(0, 10), locale), count: r.payment_count })}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money paise={r.total_paise} className="font-medium" />
                  <RunStatusBadge status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Send} title={t("noRuns")} body={t("noRunsBody")} />
      )}
    </>
  );
}
