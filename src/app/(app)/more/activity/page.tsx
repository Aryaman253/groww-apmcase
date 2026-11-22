import { getLocale, getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { maskAccount } from "@/lib/validation";

export const metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("activity");
  const tm = await getTranslations("more");
  const tv = await getTranslations("vendors.detail.source");
  const locale = await getLocale();
  const sp = await searchParams;
  let q = ctx.supabase.from("activity_log").select("*").eq("workspace_id", ctx.workspace.id).order("id", { ascending: false }).limit(100);
  if (sp.before && /^\d+$/.test(sp.before)) q = q.lt("id", Number(sp.before));
  const { data: rows } = await q;
  const fmt = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  return (
    <>
      <PageHeader title={t("title")} description={t("body")} backHref="/more" backLabel={tm("title")} />
      {!rows?.length ? <p className="text-text-secondary">{t("empty")}</p> : null}
      <ol className="flex flex-col gap-2" data-testid="activity-list">
        {(rows ?? []).map((r) => {
          const d = (r.details ?? {}) as Record<string, string | number | null>;
          const extra: string[] = [];
          if (d.old_last4 || d.new_last4) extra.push(t("details.account", { old: d.old_last4 ? maskAccount(String(d.old_last4)) : "—", new: d.new_last4 ? maskAccount(String(d.new_last4)) : "—" }));
          if (d.source && typeof d.source === "string" && ["manual", "autofill", "vendor_link", "import", "demo"].includes(d.source)) extra.push(t("details.source", { source: tv(d.source) }));
          if (d.utr) extra.push(t("details.utr", { utr: String(d.utr) }));
          if (d.reason) extra.push(t("details.reason", { reason: String(d.reason) }));
          if (d.name) extra.push(String(d.name));
          const who = r.actor_id === ctx.user.id ? t("you") : r.actor_id ? "—" : d.source === "vendor_link" ? t("vendorLink") : t("system");
          return (
            <li key={r.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{t.has(`actions.${r.action.replaceAll(".", "_")}`) ? t(`actions.${r.action.replaceAll(".", "_")}`) : r.action}</p>
                <time className="shrink-0 text-xs text-text-secondary" dateTime={r.created_at}>
                  {fmt.format(new Date(r.created_at))}
                </time>
              </div>
              {extra.length ? <p className="tabular mt-1 text-sm text-text-secondary">{extra.join(" · ")}</p> : null}
              <p className="mt-0.5 text-xs text-text-tertiary">{t("by", { who })}</p>
            </li>
          );
        })}
      </ol>
      {rows && rows.length === 100 ? (
        <a href={`/more/activity?before=${rows[rows.length - 1].id}`} className="mt-4 flex h-11 items-center justify-center rounded-lg border">
          {(await getTranslations("common"))("next")}
        </a>
      ) : null}
    </>
  );
}
