import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, ChevronRight, Clock, FileWarning, ShieldAlert, UserX } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { getHomeData } from "@/lib/server/home";
import { formatInr, formatInrRounded } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { RunStatusBadge } from "@/components/app/run-status";
import { Money } from "@/components/app/money";
import { Tour } from "./tour";
import { StartRunButton } from "../pay/start-run-button";

export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("home");
  const locale = await getLocale();
  const d = await getHomeData(ctx);
  const sp = await searchParams;

  type Item = { key: string; icon: typeof AlertTriangle; text: string; href: string; action: string; tone: string };
  const items: Item[] = [];
  if (d.changed) items.push({ key: "changed", icon: ShieldAlert, text: t("attention.changed", { count: d.changed }), href: "/vendors?filter=changed", action: t("attention.changedAction"), tone: "text-warning" });
  if (d.missingUtr)
    items.push({ key: "utr", icon: FileWarning, text: t("attention.missingUtr", { number: d.missingUtr.run.run_number, count: d.missingUtr.count }), href: `/pay/${d.missingUtr.run.id}`, action: t("attention.resume"), tone: "text-warning" });
  if (d.overdueCount)
    items.push({ key: "overdue", icon: Clock, text: t("attention.overdue", { count: d.overdueCount, amount: formatInr(d.overdueTotal) }), href: "/bills?tab=overdue", action: t("attention.overdueAction"), tone: "text-danger" });
  if (d.unreviewed) items.push({ key: "unreviewed", icon: ShieldAlert, text: t("attention.unreviewed", { count: d.unreviewed }), href: "/vendors?filter=new", action: t("attention.changedAction"), tone: "text-info" });
  if (d.missing) items.push({ key: "missing", icon: UserX, text: t("attention.missing", { count: d.missing }), href: "/vendors?filter=missing", action: t("attention.missingAction"), tone: "text-danger" });
  if (d.draft) items.push({ key: "draft", icon: FileWarning, text: t("attention.draft", { number: d.draft.run_number }), href: `/pay/${d.draft.id}`, action: t("attention.resume"), tone: "text-text-secondary" });
  const attention = items.slice(0, 3);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">{t("title")}</h1>
      <section className="rounded-2xl border bg-card p-5 shadow-xs" data-tour="hero" data-testid="home-hero">
        {d.dueTotal > 0 ? (
          <>
            <p className="text-sm text-text-secondary">{t("dueBy", { date: formatDate(d.horizon, locale) })}</p>
            <p className="tabular mt-1 text-4xl font-semibold tracking-tight">{formatInrRounded(d.dueTotal)}</p>
            <p className="mt-1 text-text-secondary">{t("dueSummary", { amount: formatInr(d.dueTotal), count: d.dueVendors })}</p>
            {d.overdueTotal > 0 ? <p className="mt-1 text-sm text-danger">{t("overdueIncluded", { amount: formatInr(d.overdueTotal) })}</p> : null}
            <div className="mt-5" data-tour="start-run">
              {d.draft ? (
                <Button asChild size="lg" className="h-12 w-full text-base">
                  <Link href={`/pay/${d.draft.id}`} data-testid="start-run">
                    {t("continueDraft")}
                  </Link>
                </Button>
              ) : (
                <StartRunButton label={t("startRun")} />
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">{t("nothingDue")}</p>
            <p className="mt-1 text-text-secondary">{t("nothingDueBody")}</p>
            <Button asChild size="lg" className="mt-5 h-12 w-full text-base" data-tour="start-run">
              <Link href="/bills/new">{t("addBills")}</Link>
            </Button>
          </>
        )}
      </section>

      <section aria-labelledby="attention-h" className="flex flex-col gap-3">
        <h2 id="attention-h" className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
          {t("needsAttention")}
        </h2>
        {attention.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-text-secondary">{t("allGood")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="needs-attention">
            {attention.map(({ key, icon: Icon, text, href, action, tone }) => (
              <li key={key}>
                <Link href={href} className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-surface-hover">
                  <Icon className={`size-5 shrink-0 ${tone}`} aria-hidden />
                  <span className="flex-1 text-sm">{text}</span>
                  <span className="text-sm font-medium">{action}</span>
                  <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="runs-h" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="runs-h" className="text-sm font-semibold tracking-wide text-text-secondary uppercase">
            {t("recentRuns")}
          </h2>
          {d.recentRuns.length ? (
            <Link href="/pay" className="text-sm font-medium text-text-secondary hover:text-foreground">
              {(await getTranslations("common"))("viewAll")}
            </Link>
          ) : null}
        </div>
        {d.recentRuns.length === 0 ? (
          <p className="text-text-secondary">{t("noRuns")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.recentRuns.map((r) => (
              <li key={r.id}>
                <Link href={`/pay/${r.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-surface-hover">
                  <div className="flex-1 space-y-1">
                    <p className="font-medium">{t("runLabel", { number: r.run_number })}</p>
                    <p className="text-sm text-text-secondary">
                      {t("runMeta", { date: formatDate((r.confirmed_at ?? r.created_at).slice(0, 10), locale), count: r.payment_count })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money paise={r.total_paise} className="font-medium" />
                    <RunStatusBadge status={r.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Tour autoStart={sp.tour === "1" || (ctx.workspace.is_demo && !ctx.workspace.settings?.tourDone)} />
    </div>
  );
}
