"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ShieldAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Money } from "@/components/app/money";
import { StickyBar } from "@/components/app/sticky-bar";
import { HoldToConfirm } from "@/components/app/hold-to-confirm";
import { groupBillsIntoPayments, paymentWarnings, runTotals, suggestMethod, type PaymentHistoryEntry, type PaymentMethod, type PaymentWarningCode } from "@/lib/payments";
import type { PlanBill, PlanVendor } from "@/lib/server/runs";
import { amountInWords } from "@/lib/amount-words";
import { addDays, formatDate, todayIst } from "@/lib/dates";
import { formatInr, parseAmountToPaise, paiseToDecimalString } from "@/lib/money";
import { maskAccount } from "@/lib/validation";
import { confirmRun, discardDraft, saveDraft, type DraftState } from "@/app/(app)/pay/actions";
import { cn } from "@/lib/utils";

type Debit = { id: string; bank_name: string; nickname: string; account_last4: string; is_default: boolean };

const BLOCKING: PaymentWarningCode[] = ["CHANGED_AWAITING_APPROVAL", "BANK_NOT_APPROVED", "VENDOR_NOT_VERIFIED", "HOLD_PERIOD"];

export function RunWizard({
  runId,
  runNumber: _runNumber,
  initial,
  bills,
  vendors,
  history,
  newPayeeVendorIds,
  debitAccounts,
  directPayAvailable,
  hold24h,
}: {
  runId: string;
  runNumber: number;
  initial: DraftState;
  bills: PlanBill[];
  vendors: PlanVendor[];
  history: PaymentHistoryEntry[];
  newPayeeVendorIds: string[];
  debitAccounts: Debit[];
  directPayAvailable: boolean;
  hold24h: boolean;
}) {
  const t = useTranslations("pay");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const today = todayIst();
  const [s, setS] = useState<DraftState>(() => ({ ...initial, excludedVendorIds: initial.excludedVendorIds ?? [] }));
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const newPayees = useMemo(() => new Set(newPayeeVendorIds), [newPayeeVendorIds]);

  // Autosave the draft (debounced).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => void saveDraft(runId, s), 800);
    return () => clearTimeout(id);
  }, [s, runId]);

  const selected = useMemo(() => new Set(s.selectedBillIds), [s.selectedBillIds]);
  const excluded = useMemo(() => new Set(s.excludedVendorIds ?? []), [s.excludedVendorIds]);

  const proposals = useMemo(() => {
    const chosen = bills.filter((b) => selected.has(b.id));
    return groupBillsIntoPayments(chosen, vendors, { amounts: s.amounts }).map((p) => {
      const v = vendorById.get(p.vendorId)!;
      const w = paymentWarnings(v, { amountPaise: p.amountPaise, billIds: p.allocations.map((a) => a.billId) }, history, { hold: { enabled: hold24h } });
      let warnings: PaymentWarningCode[] = w.warnings.filter((x) => x !== "NEW_PAYEE");
      // One clear reason per problem: "changed" already implies "not approved".
      if (warnings.includes("CHANGED_AWAITING_APPROVAL")) warnings = warnings.filter((x) => x !== "BANK_NOT_APPROVED" && x !== "VENDOR_NOT_VERIFIED");
      if (warnings.includes("BANK_NOT_APPROVED")) warnings = warnings.filter((x) => x !== "VENDOR_NOT_VERIFIED");
      if (newPayees.has(v.id) && !w.excluded) warnings.push("NEW_PAYEE");
      const method: PaymentMethod | null = s.methods[v.id] ?? suggestMethod(v, { directPayAvailable });
      return { ...p, v, warnings, blocking: w.blocking, missing: w.excluded, method, removed: excluded.has(v.id) };
    });
  }, [bills, selected, vendors, s.amounts, s.methods, history, hold24h, newPayees, directPayAvailable, vendorById, excluded]);

  const payable = proposals.filter((p) => !p.missing && !p.removed && !p.error);
  const blocked = payable.filter((p) => p.blocking);
  const final = payable.filter((p) => !p.blocking);
  const totals = runTotals(final);
  const selectedTotal = bills.filter((b) => selected.has(b.id)).reduce((x, b) => x + b.amountPaise, 0);
  const debit = debitAccounts.find((d) => d.id === s.debitAccountId);

  const stepIdx = { select: 1, review: 2, confirm: 3 }[s.step];
  const go = (step: DraftState["step"]) => {
    setS((x) => ({ ...x, step }));
    window.scrollTo({ top: 0 });
  };

  function setUpTo(kind: "overdue" | "week" | "fortnight" | "all") {
    const upTo = kind === "overdue" ? addDays(today, -1) : kind === "week" ? addDays(today, 7) : kind === "fortnight" ? addDays(today, 15) : "2999-12-31";
    setS((x) => ({ ...x, upToDate: upTo === "2999-12-31" ? addDays(today, 3650) : upTo, selectedBillIds: bills.filter((b) => b.dueDate <= upTo).map((b) => b.id) }));
  }

  function toggleBill(id: string, on: boolean) {
    setS((x) => ({ ...x, selectedBillIds: on ? [...new Set([...x.selectedBillIds, id])] : x.selectedBillIds.filter((b) => b !== id) }));
  }

  // Bills grouped by vendor for the select step.
  const byVendor = useMemo(() => {
    const m = new Map<string, PlanBill[]>();
    for (const b of bills) m.set(b.vendorId, [...(m.get(b.vendorId) ?? []), b]);
    return [...m.entries()].map(([vid, list]) => ({ v: vendorById.get(vid)!, list })).sort((a, b) => a.list[0].dueDate.localeCompare(b.list[0].dueDate));
  }, [bills, vendorById]);

  function doConfirm() {
    start(async () => {
      const res = await confirmRun(runId, s, totals.totalPaise);
      if (!res.ok) {
        setConfirmOpen(false);
        const key = `confirm.errors.${res.error}`;
        toast.error(t.has(key) ? t(key, { vendors: (res.vendors ?? []).join(", ") }) : tc("somethingWrong"));
        if (res.error === "TOTAL_CHANGED" || res.error === "BLOCKED") router.refresh();
        return;
      }
      toast.success(t("confirm.confirmed"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="run-wizard">
      <div className="flex items-center justify-between">
        <ol className="flex gap-1.5" aria-label={t("stepOf", { current: stepIdx, total: 5 })}>
          {(["select", "review", "confirm", "pay", "results"] as const).map((k, i) => (
            <li key={k} className={cn("h-1.5 w-8 rounded-full", i < stepIdx ? "bg-brand" : "bg-border-strong/60")} aria-current={i + 1 === stepIdx ? "step" : undefined}>
              <span className="sr-only">{t(`steps.${k}`)}</span>
            </li>
          ))}
        </ol>
        <button type="button" className="min-h-11 text-sm text-text-secondary hover:text-foreground" onClick={() => setDiscardOpen(true)}>
          {t("discard")}
        </button>
      </div>
      <h2 className="text-xl font-semibold">
        {t("stepOf", { current: stepIdx, total: 5 })} · {t(`steps.${s.step}`)}
      </h2>

      {s.step === "select" ? (
        <section className="flex flex-col gap-4" data-testid="step-select">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {(["overdue", "week", "fortnight", "all"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setUpTo(k)} className="min-h-9 shrink-0 rounded-full border bg-card px-3 text-sm whitespace-nowrap hover:bg-surface-hover">
                {t(`select.quick.${k}`)}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-text-secondary">{t("select.upTo")}</span>
            <Input
              type="date"
              value={s.upToDate}
              className="h-11 w-44"
              onChange={(e) => {
                const upTo = e.target.value;
                if (upTo) setS((x) => ({ ...x, upToDate: upTo, selectedBillIds: bills.filter((b) => b.dueDate <= upTo).map((b) => b.id) }));
              }}
            />
          </label>
          <div className="flex gap-2">
            <Button variant="outline" className="h-10" onClick={() => setS((x) => ({ ...x, selectedBillIds: bills.map((b) => b.id) }))}>
              {t("select.selectAll")}
            </Button>
            <Button variant="ghost" className="h-10" onClick={() => setS((x) => ({ ...x, selectedBillIds: [] }))}>
              {t("select.selectNone")}
            </Button>
          </div>
          {byVendor.length === 0 ? <p className="py-8 text-center text-text-secondary">{t("select.empty")}</p> : null}
          <ul className="flex flex-col gap-2">
            {byVendor.map(({ v, list }) => {
              const all = list.every((b) => selected.has(b.id));
              const some = list.some((b) => selected.has(b.id));
              const missing = !v.last4 && !v.upiId && v.status !== "changed" && !(v.bankDetails ?? []).some((d) => d.status === "pending");
              return (
                <li key={v.id} className="rounded-xl border bg-card">
                  <label className="flex min-h-14 items-center gap-3 px-4 py-3">
                    <Checkbox
                      className="size-5"
                      checked={all ? true : some ? "indeterminate" : false}
                      onCheckedChange={(c) => setS((x) => ({ ...x, selectedBillIds: c === true ? [...new Set([...x.selectedBillIds, ...list.map((b) => b.id)])] : x.selectedBillIds.filter((id) => !list.some((b) => b.id === id)) }))}
                      aria-label={v.name}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{v.name}</span>
                      <span className="block text-xs text-text-secondary">
                        {missing ? <span className="text-danger">{t("select.excludedMissing")}</span> : t("select.vendorBills", { count: list.length })}
                      </span>
                    </span>
                    <Money paise={list.reduce((x, b) => x + b.amountPaise, 0)} className="text-sm font-medium" />
                  </label>
                  {list.length > 1 || list.some((b) => b.dueDate < today) ? (
                    <ul className="border-t px-4 py-1">
                      {list.map((b) => (
                        <li key={b.id}>
                          <label className="flex min-h-11 items-center gap-3 text-sm">
                            <Checkbox className="size-5" checked={selected.has(b.id)} onCheckedChange={(c) => toggleBill(b.id, c === true)} aria-label={b.invoiceNumber} />
                            <span className="min-w-0 flex-1 truncate">{b.invoiceNumber}</span>
                            <span className={cn("text-xs", b.dueDate < today ? "text-danger" : "text-text-secondary")}>
                              {b.dueDate < today ? t("select.overdue") : formatDate(b.dueDate, locale)}
                            </span>
                            <Money paise={b.amountPaise} className="w-28 text-right" />
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <StickyBar className="flex items-center gap-3">
            <div className="flex-1">
              <p className="tabular text-sm text-text-secondary">{t("select.selectedSummary", { count: s.selectedBillIds.length, amount: formatInr(selectedTotal) })}</p>
            </div>
            <Button size="lg" className="h-12 px-6" disabled={!s.selectedBillIds.length} onClick={() => go("review")} data-testid="to-review">
              {tc("next")}
            </Button>
          </StickyBar>
        </section>
      ) : null}

      {s.step === "review" ? (
        <section className="flex flex-col gap-4" data-testid="step-review">
          <label className="space-y-1.5">
            <span className="text-sm text-text-secondary">{t("review.debitAccount")}</span>
            {debitAccounts.length ? (
              <select
                className="h-12 w-full rounded-lg border bg-background px-3"
                value={s.debitAccountId ?? ""}
                onChange={(e) => setS((x) => ({ ...x, debitAccountId: e.target.value || null }))}
                data-testid="debit-account"
              >
                {debitAccounts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nickname} · {d.bank_name} {maskAccount(d.account_last4)}
                  </option>
                ))}
              </select>
            ) : (
              <Link href="/more/bank-accounts" className="flex h-12 items-center rounded-lg border border-dashed px-3 text-sm">
                {t("review.addDebit")}
              </Link>
            )}
          </label>
          {blocked.length ? (
            <p className="flex items-start gap-2 rounded-xl bg-danger-bg p-3 text-sm text-danger" role="alert">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("review.blockedTitle")}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2" data-testid="review-list">
            {proposals.map((p) => {
              const isBlocked = !p.missing && p.blocking;
              const methodsAvail: PaymentMethod[] = [
                ...(directPayAvailable && (p.v.last4 || p.v.upiId) ? (["direct"] as const) : []),
                ...(p.v.last4 ? (["bank_file"] as const) : []),
                ...(p.v.upiId ? (["upi"] as const) : []),
              ];
              return (
                <li
                  key={p.vendorId}
                  data-testid="review-row"
                  data-vendor={p.vendorName}
                  className={cn("rounded-xl border bg-card p-4", (p.missing || p.removed) && "opacity-60", isBlocked && !p.removed && "border-danger/50")}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.vendorName}</p>
                      <p className="truncate text-xs text-text-secondary">
                        {p.v.last4 ? maskAccount(p.v.last4) : p.v.upiId ?? "—"} · {t("review.invoices", { list: p.remarks || "—" })}
                      </p>
                    </div>
                    <button type="button" className="text-right" onClick={() => setEditing(editing === p.vendorId ? null : p.vendorId)} aria-label={t("review.editAmount")} disabled={p.missing || p.removed}>
                      <Money paise={p.amountPaise || p.totalDuePaise} className="font-semibold" />
                      {p.amountPaise && p.amountPaise < p.totalDuePaise ? <span className="block text-xs text-text-secondary">{t("review.partOf", { amount: formatInr(p.totalDuePaise) })}</span> : null}
                    </button>
                  </div>
                  {editing === p.vendorId ? (
                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        inputMode="decimal"
                        autoFocus
                        defaultValue={paiseToDecimalString(p.amountPaise || p.totalDuePaise)}
                        className="tabular h-11"
                        aria-label={t("review.editAmount")}
                        onBlur={(e) => {
                          const v = parseAmountToPaise(e.target.value);
                          setS((x) => {
                            const amounts = { ...x.amounts };
                            if (!v || v >= p.totalDuePaise) delete amounts[p.vendorId];
                            else amounts[p.vendorId] = v;
                            return { ...x, amounts };
                          });
                          setEditing(null);
                        }}
                      />
                    </div>
                  ) : null}
                  {p.error ? <p className="mt-2 text-sm text-danger">{t(`review.warnings.${p.error === "NO_BILLS" ? "INVALID_AMOUNT" : p.error}`)}</p> : null}
                  {!p.missing && !p.removed && methodsAvail.length ? (
                    <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1" role="radiogroup" aria-label={t("review.method")}>
                      {(["direct", "bank_file", "upi"] as const).map((m) => {
                        const avail = methodsAvail.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={p.method === m}
                            disabled={!avail}
                            onClick={() => setS((x) => ({ ...x, methods: { ...x.methods, [p.vendorId]: m } }))}
                            className={cn("min-h-10 rounded-md text-xs", p.method === m ? "bg-card font-medium shadow-xs" : "text-text-secondary", !avail && "opacity-40")}
                          >
                            {t(`review.methods.${m}`)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {(p.missing ? (["MISSING_BANK_DETAILS"] as PaymentWarningCode[]) : p.warnings).length && !p.removed ? (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {(p.missing ? (["MISSING_BANK_DETAILS"] as PaymentWarningCode[]) : p.warnings).map((w) => (
                        <li key={w} className={cn("flex items-start gap-2 text-sm", BLOCKING.includes(w) || w === "MISSING_BANK_DETAILS" ? "text-danger" : w === "NEW_PAYEE" ? "text-info" : "text-warning")} data-warning={w}>
                          {w === "NEW_PAYEE" ? <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                          <span className="flex-1">{t(`review.warnings.${w}`)}</span>
                          {BLOCKING.includes(w) || w === "MISSING_BANK_DETAILS" ? (
                            <Link href={w === "MISSING_BANK_DETAILS" ? `/vendors/${p.vendorId}/bank` : `/vendors/${p.vendorId}/review`} className="font-medium underline">
                              {t("review.fix")}
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {!p.missing ? (
                    <button
                      type="button"
                      className="mt-2 min-h-10 text-sm text-text-secondary underline"
                      onClick={() => setS((x) => ({ ...x, excludedVendorIds: p.removed ? (x.excludedVendorIds ?? []).filter((id) => id !== p.vendorId) : [...(x.excludedVendorIds ?? []), p.vendorId] }))}
                    >
                      {p.removed ? t("review.include") : t("review.exclude")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <StickyBar className="flex items-center gap-3">
            <Button variant="outline" size="lg" className="h-12" onClick={() => go("select")}>
              {tc("back")}
            </Button>
            <div className="flex-1 text-right">
              <Money paise={totals.totalPaise} className="block font-semibold" />
              <span className="text-xs text-text-secondary">{t("review.footer", { count: totals.count })}</span>
            </div>
            <Button size="lg" className="h-12 px-6" disabled={!totals.count || blocked.length > 0 || !s.debitAccountId} onClick={() => go("confirm")} data-testid="to-confirm">
              {tc("next")}
            </Button>
          </StickyBar>
        </section>
      ) : null}

      {s.step === "confirm" ? (
        <section className="flex flex-col gap-4" data-testid="step-confirm">
          <div className="rounded-2xl border bg-card p-5">
            <p className="text-sm text-text-secondary">{t("confirm.total")}</p>
            <Money paise={totals.totalPaise} className="text-4xl font-semibold tracking-tight" />
            <p className="mt-1 text-text-secondary">{t("confirm.count", { count: totals.count })}{debit ? ` · ${t("confirm.from", { account: `${debit.nickname} ${maskAccount(debit.account_last4)}` })}` : ""}</p>
            <div className="mt-4 space-y-2 border-t pt-4 text-sm">
              <p className="text-text-secondary">{t("confirm.inWords")}</p>
              <p data-testid="amount-words-en">{amountInWords(totals.totalPaise, "en")}</p>
              <p lang="hi" data-testid="amount-words-hi">{amountInWords(totals.totalPaise, "hi")}</p>
            </div>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {(["direct", "bank_file", "upi"] as const).map((m) => {
              const list = final.filter((p) => p.method === m);
              if (!list.length) return null;
              return (
                <li key={m} className="flex justify-between rounded-lg bg-secondary px-3 py-2">
                  <span>{t(`review.methods.${m}`)} · {list.length}</span>
                  <Money paise={list.reduce((x, p) => x + p.amountPaise, 0)} />
                </li>
              );
            })}
          </ul>
          <details className="rounded-xl border bg-card p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium">
              {t("confirm.count", { count: totals.count })} <ChevronDown className="size-4" aria-hidden />
            </summary>
            <ul className="mt-2 divide-y text-sm">
              {final.map((p) => (
                <li key={p.vendorId} className="flex justify-between gap-3 py-2">
                  <span className="truncate">{p.vendorName}</span>
                  <Money paise={p.amountPaise} />
                </li>
              ))}
            </ul>
          </details>
          <StickyBar className="flex gap-2">
            <Button variant="outline" size="lg" className="h-12" onClick={() => go("review")}>
              {tc("back")}
            </Button>
            <Button size="lg" className="h-12 flex-1" onClick={() => setConfirmOpen(true)} data-testid="open-confirm">
              {t("steps.confirm")} <Money paise={totals.totalPaise} />
            </Button>
          </StickyBar>
        </section>
      ) : null}

      <Drawer open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("confirm.sheetTitle", { amount: formatInr(totals.totalPaise) })}</DrawerTitle>
            <DrawerDescription>
              {t("confirm.sheetBody", { count: totals.count, account: debit ? `${debit.nickname} ${maskAccount(debit.account_last4)}` : "" })}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="pb-safe">
            <HoldToConfirm label={t("confirm.hold")} holdingLabel={t("confirm.holding")} onConfirm={doConfirm} disabled={pending} testId="hold-confirm" />
            <Button variant="ghost" className="h-12" onClick={() => setConfirmOpen(false)}>
              {tc("cancel")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <Drawer open={discardOpen} onOpenChange={setDiscardOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("discardTitle")}</DrawerTitle>
            <DrawerDescription>{t("discardBody")}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="pb-safe">
            <Button variant="destructive" size="lg" className="h-12" onClick={() => start(() => discardDraft(runId))}>
              {t("discard")}
            </Button>
            <Button variant="outline" size="lg" className="h-12" onClick={() => setDiscardOpen(false)}>
              {tc("cancel")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
