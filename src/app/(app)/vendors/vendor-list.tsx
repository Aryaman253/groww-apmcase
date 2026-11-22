"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, Users, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/app/money";
import { VendorStatusBadge } from "@/components/app/vendor-status";
import { EmptyState } from "@/components/app/empty-state";
import { PullToRefresh } from "@/components/app/pull-to-refresh";
import { Button } from "@/components/ui/button";
import { maskAccount } from "@/lib/validation";
import { cn } from "@/lib/utils";

type Item = { id: string; name: string; last4: string | null; upi: string | null; status: "verified" | "new" | "changed" | "missing"; duePaise: number; gstin: string | null };
const FILTERS = ["all", "verified", "new", "changed", "missing"] as const;
type Filter = (typeof FILTERS)[number];

export function VendorList({ vendors, initialFilter }: { vendors: Item[]; initialFilter?: string }) {
  const t = useTranslations("vendors");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>((FILTERS as readonly string[]).includes(initialFilter ?? "") ? (initialFilter as Filter) : "all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: vendors.length };
    for (const v of vendors) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [vendors]);
  const shown = vendors.filter((v) => {
    if (filter !== "all" && v.status !== filter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return v.name.toLowerCase().includes(s) || (v.upi ?? "").includes(s) || (v.gstin ?? "").toLowerCase().includes(s) || (v.last4 ?? "").includes(s);
  });

  if (vendors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <Button asChild className="h-11">
            <Link href="/vendors/new">{t("add")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <PullToRefresh>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-11 pl-9"
        />
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={t("title")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap",
              filter === f ? "border-foreground bg-foreground text-background" : "bg-card text-text-secondary hover:text-foreground",
            )}
          >
            {t(`filters.${f}`)} {counts[f] ? <span className="tabular opacity-70">{counts[f]}</span> : null}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-text-secondary">{t("emptyFiltered")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="vendor-list">
          {shown.map((v) => (
            <li key={v.id}>
              <Link href={`/vendors/${v.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-surface-hover">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{v.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
                    <span className="tabular">{v.last4 ? maskAccount(v.last4) : v.upi ? null : t("noBank")}</span>
                    {v.upi ? <span className="truncate">{v.upi}</span> : null}
                  </div>
                  <VendorStatusBadge status={v.status} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  {v.duePaise > 0 ? (
                    <>
                      <span className="text-xs text-text-secondary">{t("due")}</span>
                      <Money paise={v.duePaise} className="font-medium" />
                    </>
                  ) : null}
                </div>
                <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PullToRefresh>
  );
}
