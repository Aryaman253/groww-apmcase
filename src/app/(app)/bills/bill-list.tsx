"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ReceiptText, ChevronRight } from "lucide-react";
import { Money } from "@/components/app/money";
import { EmptyState } from "@/components/app/empty-state";
import { PullToRefresh } from "@/components/app/pull-to-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatInr } from "@/lib/money";
import { cn } from "@/lib/utils";

export type BillItem = {
  id: string;
  vendorId: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string;
  amountPaise: number;
  paidPaise: number;
  paidAt: string | null;
  tab: "due" | "overdue" | "scheduled" | "paid" | "on_hold";
};
const TABS = ["due", "overdue", "scheduled", "paid", "on_hold"] as const;

export function BillList({
  bills,
  vendors,
  today,
  initialTab,
  initialVendor,
}: {
  bills: BillItem[];
  vendors: { id: string; name: string }[];
  today: string;
  initialTab?: string;
  initialVendor?: string;
}) {
  const t = useTranslations("bills");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [tab, setTab] = useState<(typeof TABS)[number]>((TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as (typeof TABS)[number]) : "due");
  const [vendor, setVendor] = useState(initialVendor ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () =>
      bills.filter((b) => {
        if (vendor && b.vendorId !== vendor) return false;
        const d = b.tab === "paid" ? (b.paidAt ?? "").slice(0, 10) : b.dueDate;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [bills, vendor, from, to],
  );
  const byTab = (k: string) => filtered.filter((b) => b.tab === k);
  const shown = byTab(tab).sort((a, b) => (tab === "paid" ? (b.paidAt ?? "").localeCompare(a.paidAt ?? "") : a.dueDate.localeCompare(b.dueDate)));
  const total = shown.reduce((s, b) => s + (tab === "paid" ? b.amountPaise : b.amountPaise - b.paidPaise), 0);

  if (bills.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <Button asChild className="h-11">
            <Link href="/bills/new">{t("add")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <PullToRefresh>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={t("title")}>
        {TABS.map((k) => {
          const n = byTab(k).length;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              data-testid={`bills-tab-${k}`}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap",
                tab === k ? "border-foreground bg-foreground text-background" : "bg-card text-text-secondary hover:text-foreground",
              )}
            >
              {t(`tabs.${k}`)} {n ? <span className="tabular opacity-70">{n}</span> : null}
            </button>
          );
        })}
      </div>
      <details className="mb-3 rounded-xl border bg-card px-4 py-2">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm">
          <span>{vendor ? vendors.find((v) => v.id === vendor)?.name : t("filterVendor")}</span>
          <span className="text-text-secondary">{from || to ? `${from ? formatDate(from, locale) : "…"} – ${to ? formatDate(to, locale) : "…"}` : ""}</span>
        </summary>
        <div className="grid grid-cols-2 gap-3 py-3">
          <label className="col-span-2 space-y-1 text-sm">
            <span>{tc("vendor")}</span>
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-11 w-full rounded-lg border bg-background px-3">
              <option value="">{t("filterVendor")}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>{t("filterFrom")}</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" />
          </label>
          <label className="space-y-1 text-sm">
            <span>{t("filterTo")}</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
          </label>
          {vendor || from || to ? (
            <Button variant="ghost" className="col-span-2 h-10" onClick={() => { setVendor(""); setFrom(""); setTo(""); }}>
              {t("clearFilters")}
            </Button>
          ) : null}
        </div>
      </details>
      <p className="tabular mb-3 text-sm text-text-secondary" data-testid="bills-tab-total">
        {t("tabTotal", { count: shown.length, amount: formatInr(total) })}
      </p>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-text-secondary">{t("emptyTitle")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="bill-list">
          {shown.map((b) => {
            const days = daysBetween(today, b.dueDate);
            return (
              <li key={b.id}>
                <Link href={`/bills/${b.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-surface-hover">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium">{b.vendorName}</p>
                    <p className="truncate text-sm text-text-secondary">{t("invoiceNo", { number: b.invoiceNumber })}</p>
                    <p className={cn("text-sm", b.tab === "overdue" ? "text-danger" : "text-text-secondary")}>
                      {b.tab === "paid"
                        ? t("paidOn", { date: formatDate((b.paidAt ?? "").slice(0, 10), locale) })
                        : b.tab === "overdue"
                          ? t("overdueBy", { days: -days })
                          : days <= 7 && days >= 0
                            ? t("dueIn", { days })
                            : t("dueOn", { date: formatDate(b.dueDate, locale) })}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money paise={b.tab === "paid" ? b.amountPaise : b.amountPaise - b.paidPaise} className="font-medium" />
                    {b.paidPaise > 0 && b.tab !== "paid" ? <p className="text-xs text-text-secondary">{t("partPaid", { amount: formatInr(b.paidPaise) })}</p> : null}
                  </div>
                  <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PullToRefresh>
  );
}
