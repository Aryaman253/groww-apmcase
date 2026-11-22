"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Download, Copy, MessageCircle, Printer, FileSpreadsheet, CheckCircle2, XCircle, Upload, AlertTriangle, Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Money } from "@/components/app/money";
import { StatusBadge, TestModeBadge } from "@/components/app/status-badge";
import { HoldToConfirm } from "@/components/app/hold-to-confirm";
import { formatInr } from "@/lib/money";
import { maskAccount } from "@/lib/validation";
import { upiDeepLink, whatsappLink, reconcileStatusRows, paymentReference, type StatusRow } from "@/lib/payments";
import { readSpreadsheet } from "@/lib/import";
import { parseImportAmount } from "@/lib/import";
import { markPaymentsSent, recordUtr, markPaymentFailed, skipPayment, applyStatusResults } from "@/app/(app)/pay/actions";
import { startDirectPay, refreshDirectPay } from "@/app/(app)/pay/direct-actions";
import { cn } from "@/lib/utils";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

export type RunPaymentView = {
  id: string;
  vendorId: string;
  vendorName: string;
  phone: string | null;
  method: "direct" | "bank_file" | "upi";
  status: "pending" | "sent" | "processing" | "paid" | "failed" | "reversed" | "skipped";
  amountPaise: number;
  utr: string | null;
  failureReason: string | null;
  last4: string | null;
  upiId: string | null;
  invoiceNumbers: string[];
  remarks: string | null;
  verification: { nameMatch?: boolean; nameAtBank?: string | null; overridden?: boolean } | null;
};

const tone = (s: RunPaymentView["status"]) => (s === "paid" ? "success" : s === "failed" || s === "reversed" ? "danger" : s === "skipped" ? "neutral" : "info");

export function RunView({
  runId,
  runNumber,
  runStatus,
  payments,
  businessName,
  provider,
  directPayAvailable,
}: {
  runId: string;
  runNumber: number;
  runStatus: string;
  payments: RunPaymentView[];
  businessName: string;
  provider: string | null;
  directPayAvailable: boolean;
}) {
  const t = useTranslations("pay");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const live = payments.filter((p) => p.status !== "skipped");
  const byMethod = (m: RunPaymentView["method"]) => live.filter((p) => p.method === m);
  const unresolved = live.filter((p) => ["pending", "sent", "processing"].includes(p.status));
  const done = runStatus === "completed" || runStatus === "partly_failed";
  const shortId = `R${String(runNumber).padStart(4, "0")}`;

  // Poll while direct payouts are in flight (webhooks are primary; this is the fallback + UI refresh).
  const inflight = live.some((p) => p.method === "direct" && ["sent", "processing"].includes(p.status));
  useEffect(() => {
    if (!inflight) return;
    const id = setInterval(() => {
      start(async () => {
        await refreshDirectPay(runId);
        router.refresh();
      });
    }, 6000);
    return () => clearInterval(id);
  }, [inflight, runId, router]);

  return (
    <div className="flex flex-col gap-6" data-testid="run-view">
      {done ? <Completion runStatus={runStatus} payments={live} businessName={businessName} runId={runId} /> : null}

      {!done ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{t("payStep.title")}</h2>
          <p className="text-text-secondary">{t("payStep.intro")}</p>
          {byMethod("direct").length ? (
            <DirectPayCard runId={runId} payments={byMethod("direct")} provider={provider} available={directPayAvailable} />
          ) : null}
          {byMethod("bank_file").length ? <BankFileCard runId={runId} payments={byMethod("bank_file")} /> : null}
          {byMethod("upi").length ? <UpiCard payments={byMethod("upi")} shortId={shortId} /> : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3" data-testid="results">
        <h2 className="text-xl font-semibold">{t("results.title")}</h2>
        {!done ? <p className="text-text-secondary">{t("results.intro")}</p> : null}
        {!done && unresolved.some((p) => p.method !== "direct") ? <StatusFileUpload runId={runId} payments={unresolved.filter((p) => p.method !== "direct")} shortId={shortId} /> : null}
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <PaymentRow key={p.id} p={p} pending={pending} locale={locale} />
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" className="h-12">
          <Link href={`/pay/${runId}/print`}>
            <Printer className="size-4" aria-hidden /> {t("results.print")}
          </Link>
        </Button>
      </div>
      <span className="sr-only">{tc("status")}</span>
    </div>
  );

  function PaymentRow({ p, pending, locale: _l }: { p: RunPaymentView; pending: boolean; locale: string }) {
    const [utr, setUtr] = useState("");
    const [fail, setFail] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const open = ["pending", "sent", "processing"].includes(p.status) && p.method !== "direct";
    void _l;
    return (
      <li className="rounded-xl border bg-card p-4" data-testid="payment-row" data-vendor={p.vendorName} data-status={p.status}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{p.vendorName}</p>
            <p className="truncate text-xs text-text-secondary">
              {t(`review.methods.${p.method}`)} · {p.last4 ? maskAccount(p.last4) : p.upiId}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Money paise={p.amountPaise} className="font-medium" />
            <StatusBadge tone={tone(p.status)}>{t(`payStep.direct.status.${p.status}`)}</StatusBadge>
          </div>
        </div>
        {p.status === "paid" && p.utr ? <p className="tabular mt-2 text-sm text-success">{t("results.paidWith", { utr: p.utr })}</p> : null}
        {(p.status === "failed" || p.status === "reversed") && p.failureReason ? (
          <p className="mt-2 text-sm text-danger">
            {t("results.failedWith", { reason: p.failureReason })} · {t("results.billsBack")}
          </p>
        ) : null}
        {open ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await recordUtr(p.id, utr);
                if (!r.ok) return setErr(t("results.invalidUtr"));
                router.refresh();
              });
            }}
          >
            <Input value={utr} onChange={(e) => { setUtr(e.target.value); setErr(null); }} placeholder={t("results.utr")} aria-label={`${t("results.utr")} — ${p.vendorName}`} className="tabular h-11 flex-1 uppercase" data-testid="utr-input" />
            <Button className="h-11" disabled={pending || utr.trim().length < 6} data-testid="utr-save">
              {t("results.saveUtr")}
            </Button>
          </form>
        ) : null}
        {err ? <p className="mt-1 text-sm text-danger">{err}</p> : null}
        {open ? (
          <div className="mt-1 flex gap-4">
            <button type="button" className="min-h-10 text-sm text-text-secondary underline" onClick={() => setFail("")}>
              {t("results.markFailed")}
            </button>
            {p.status === "pending" ? (
              <button type="button" className="min-h-10 text-sm text-text-secondary underline" onClick={() => start(async () => { await skipPayment(p.id); router.refresh(); })}>
                {t("results.remove")}
              </button>
            ) : null}
          </div>
        ) : null}
        {fail !== null ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                await markPaymentFailed(p.id, fail || "Failed at bank");
                setFail(null);
                router.refresh();
              });
            }}
          >
            <Input value={fail} onChange={(e) => setFail(e.target.value)} placeholder={t("results.failReason")} className="h-11 flex-1" autoFocus />
            <Button variant="destructive" className="h-11" disabled={pending}>
              {t("results.failed")}
            </Button>
          </form>
        ) : null}
      </li>
    );
  }
}

function BankFileCard({ runId, payments }: { runId: string; payments: RunPaymentView[] }) {
  const t = useTranslations("pay.payStep.bankFile");
  const tp = useTranslations("pay");
  const router = useRouter();
  const [check, setCheck] = useState<null | { ok: boolean; isPlaceholder: boolean; fileCount: number; rowErrors: { vendorName: string; code: string }[]; fileErrors: { code: string }[] }>(null);
  const [pending, start] = useTransition();
  const open = payments.filter((p) => p.status === "pending" || p.status === "sent");
  const total = payments.reduce((s, p) => s + p.amountPaise, 0);
  useEffect(() => {
    if (!open.length) return;
    fetch(`/api/runs/${runId}/bank-file?check=1`).then(async (r) => setCheck(await r.json())).catch(() => {});
  }, [runId, open.length]);
  const checklist = (useTranslations("pay.payStep.bankFile").raw("checklist") as string[]) ?? [];
  return (
    <div className="rounded-2xl border bg-card p-4" data-testid="bank-file-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("title")}</h3>
        <span className="text-sm text-text-secondary">{t("body", { count: payments.length, amount: formatInr(total) })}</span>
      </div>
      {check?.isPlaceholder ? <p className="mt-2 text-xs text-warning">{t("placeholder")}</p> : null}
      {check && !check.ok ? (
        <div className="mt-3 rounded-lg bg-danger-bg p-3 text-sm text-danger" role="alert">
          <p className="font-medium">{t("errorsTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {check.rowErrors.map((e, i) => (
              <li key={i}>{e.vendorName}: {e.code.replaceAll("_", " ").toLowerCase()}</li>
            ))}
            {check.fileErrors.map((e, i) => (
              <li key={`f${i}`}>{e.code.replaceAll("_", " ").toLowerCase()}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {open.length ? (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {Array.from({ length: check?.ok ? check.fileCount : 1 }).map((_, i) => (
              <Button key={i} asChild={Boolean(check?.ok)} size="lg" className="h-12" disabled={!check?.ok} data-testid="download-bank-file">
                {check?.ok ? (
                  <a href={`/api/runs/${runId}/bank-file?part=${i + 1}`} download>
                    <Download className="size-5" aria-hidden /> {t("download", { name: check.fileCount > 1 ? `#${i + 1}` : "" }).replace("  ", " ")}
                  </a>
                ) : (
                  <span>
                    <Download className="size-5" aria-hidden /> {t("download", { name: "" }).replace("  ", " ")}
                  </span>
                )}
              </Button>
            ))}
          </div>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-text-secondary">
            {checklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
          {open.some((p) => p.status === "pending") ? (
            <Button
              variant="outline"
              className="mt-3 h-11 w-full"
              disabled={pending}
              data-testid="mark-file-sent"
              onClick={() => start(async () => { await markPaymentsSent(open.filter((p) => p.status === "pending").map((p) => p.id)); router.refresh(); })}
            >
              {t("markSent")}
            </Button>
          ) : (
            <p className="mt-3 text-sm text-text-secondary">{tp("payStep.sentBadge")} ✓</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function UpiCard({ payments, shortId }: { payments: RunPaymentView[]; shortId: string }) {
  const t = useTranslations("pay.payStep.upi");
  const router = useRouter();
  const [qr, setQr] = useState<{ id: string; url: string } | null>(null);
  const [pending, start] = useTransition();
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent);
  const total = payments.reduce((s, p) => s + p.amountPaise, 0);
  return (
    <div className="rounded-2xl border bg-card p-4" data-testid="upi-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("title")}</h3>
        <span className="text-sm text-text-secondary">{t("body", { count: payments.length, amount: formatInr(total) })}</span>
      </div>
      <ul className="mt-3 divide-y">
        {payments.map((p) => {
          const link = upiDeepLink({ pa: p.upiId ?? "", pn: p.vendorName, amountPaise: p.amountPaise, tn: `${p.remarks ?? ""}`.slice(0, 50), tr: paymentReference(shortId, p.id) });
          const open = p.status === "pending" || p.status === "sent";
          return (
            <li key={p.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.vendorName}</span>
                  <span className="block truncate text-xs text-text-secondary">{p.upiId}</span>
                </span>
                <Money paise={p.amountPaise} className="text-sm font-medium" />
              </div>
              {open ? (
                <div className="flex gap-2">
                  {isMobile ? (
                    <Button asChild className="h-11 flex-1">
                      <a href={link}>{t("pay")}</a>
                    </Button>
                  ) : (
                    <Button className="h-11 flex-1" onClick={async () => setQr({ id: p.id, url: await QRCode.toDataURL(link, { margin: 1, width: 240 }) })}>
                      {t("scan")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="h-11"
                    aria-label={t("copy")}
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${p.vendorName}\nUPI: ${p.upiId}\nAmount: ${formatInr(p.amountPaise)}\n${p.remarks ?? ""}`);
                      toast.success(t("copied"));
                    }}
                  >
                    <Copy className="size-4" aria-hidden />
                  </Button>
                  {p.status === "pending" ? (
                    <Button variant="outline" className="h-11" disabled={pending} onClick={() => start(async () => { await markPaymentsSent([p.id]); router.refresh(); })}>
                      {t("markSent")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {qr?.id === p.id ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr.url} alt={t("scan")} className="mx-auto size-60 rounded-lg bg-white p-2" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DirectPayCard({ runId, payments, provider, available }: { runId: string; payments: RunPaymentView[]; provider: string | null; available: boolean }) {
  const t = useTranslations("pay.payStep.direct");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<string[]>([]);
  const toPay = payments.filter((p) => p.status === "pending");
  const total = toPay.reduce((s, p) => s + p.amountPaise, 0);
  const providerName = provider === "razorpayx" ? "RazorpayX" : provider === "cashfree" ? "Cashfree" : "simulated";
  const firing = useRef(false);

  function pay() {
    if (firing.current) return; // double-tap guard (server is idempotent too)
    firing.current = true;
    start(async () => {
      const res = await startDirectPay(runId, overrides);
      firing.current = false;
      setOpen(false);
      if (!res.ok) {
        setError(res.error === "INSUFFICIENT_BALANCE" ? t("insufficient", { balance: formatInr(res.balancePaise ?? 0) }) : res.message ?? tc("somethingWrong"));
      } else toast.success(t("sent"));
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border bg-card p-4" data-testid="direct-pay-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Zap className="size-4 text-brand" aria-hidden /> {t("title")}
        </h3>
        <TestModeBadge label={t("testBadge")} />
      </div>
      <p className="mt-1 text-sm text-text-secondary">{t("body")}</p>
      <ul className="mt-3 divide-y">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5" data-testid="direct-row" data-status={p.status}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.vendorName}</span>
              {p.verification && p.verification.nameMatch === false && !p.verification.overridden ? (
                <span className="flex items-center gap-1 text-xs text-danger">
                  <AlertTriangle className="size-3" aria-hidden /> {t("nameMismatch", { name: p.verification.nameAtBank ?? "?" })}
                  {p.status === "pending" ? (
                    <button type="button" className="ml-1 underline" onClick={() => setOverrides((o) => (o.includes(p.id) ? o.filter((x) => x !== p.id) : [...o, p.id]))}>
                      {overrides.includes(p.id) ? "✓ " : ""}{t("override")}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className="flex flex-col items-end gap-1">
              <Money paise={p.amountPaise} className="text-sm" />
              <StatusBadge tone={tone(p.status)}>
                {p.status === "processing" || p.status === "sent" ? <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : p.status === "paid" ? <CheckCircle2 className="size-3" aria-hidden /> : p.status === "failed" ? <XCircle className="size-3" aria-hidden /> : null}
                {t(`status.${p.status}`)}
              </StatusBadge>
            </span>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      {toPay.length && available ? (
        <Button size="lg" className="mt-3 h-12 w-full" onClick={() => { setError(null); setOpen(true); }} data-testid="direct-pay-btn">
          {t("payN", { amount: formatInr(total), count: toPay.length })}
        </Button>
      ) : null}
      {!toPay.length ? (
        <Button variant="ghost" className="mt-2 h-11 w-full" disabled={pending} onClick={() => start(async () => { await refreshDirectPay(runId); router.refresh(); })}>
          <RefreshCw className="size-4" aria-hidden /> {t("refresh")}
        </Button>
      ) : null}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("sheetTitle", { amount: formatInr(total) })}</DrawerTitle>
            <DrawerDescription>{t("sheetBody", { count: toPay.length, provider: providerName })}</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="pb-safe">
            <HoldToConfirm label={t("payN", { amount: formatInr(total), count: toPay.length })} holdingLabel={t("sending")} onConfirm={pay} disabled={pending} testId="direct-pay-confirm" />
            <Button variant="ghost" className="h-12" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

const STATUS_FIELDS = ["accountNumber", "amount", "reference", "utr", "status", "reason"] as const;
type SF = (typeof STATUS_FIELDS)[number];
const SYN: Record<SF, RegExp> = {
  accountNumber: /(benef.*a\/?c|account|a\/c|acct)/i,
  amount: /(amount|amt)/i,
  reference: /(ref|narration|remark|customer ref|cust ref)/i,
  utr: /(utr|bank ref|rrn|transaction id|txn id)/i,
  status: /(status|result)/i,
  reason: /(reason|remarks?|error|desc)/i,
};

function StatusFileUpload({ runId, payments, shortId }: { runId: string; payments: RunPaymentView[]; shortId: string }) {
  const t = useTranslations("pay.results");
  const tc = useTranslations("common");
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<{ headers: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [map, setMap] = useState<Partial<Record<SF, string>>>({});
  const [pending, start] = useTransition();

  const result = useMemo(() => {
    if (!sheet) return null;
    const rows: StatusRow[] = sheet.rows.map((r) => ({
      accountNumber: map.accountNumber ? String(r[map.accountNumber] ?? "") : null,
      amountPaise: map.amount ? parseImportAmount(r[map.amount]) : null,
      reference: map.reference ? String(r[map.reference] ?? "") : null,
      utr: map.utr ? String(r[map.utr] ?? "").trim() || null : null,
      status: map.status ? String(r[map.status] ?? "") : null,
      reason: map.reason ? String(r[map.reason] ?? "") : null,
    }));
    return reconcileStatusRows(
      rows,
      payments.map((p) => ({ id: p.id, reference: paymentReference(shortId, p.id), accountLast4: p.last4, amountPaise: p.amountPaise })),
    );
  }, [sheet, map, payments, shortId]);
  const applicable = (result?.matched ?? []).filter((m) => m.status !== "pending");

  return (
    <div className="rounded-2xl border border-dashed p-4">
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.csv,text/csv"
        className="sr-only"
        data-testid="status-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const res = await readSpreadsheet(await f.arrayBuffer(), f.name);
          const s = res.sheets.find((x) => x.rows.length) ?? null;
          if (!s) return void toast.error(tc("somethingWrong"));
          const guess: Partial<Record<SF, string>> = {};
          for (const k of STATUS_FIELDS) {
            const h = s.headers.find((h) => SYN[k].test(h) && !Object.values(guess).includes(h));
            if (h) guess[k] = h;
          }
          setMap(guess);
          setSheet({ headers: s.headers, rows: s.rows });
        }}
      />
      {!sheet ? (
        <Button variant="outline" className="h-12 w-full" onClick={() => ref.current?.click()}>
          <Upload className="size-4" aria-hidden /> {t("uploadStatus")}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-medium">{t("mapTitle")}</p>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_FIELDS.map((k) => (
              <label key={k} className="space-y-1 text-xs">
                <span className="text-text-secondary">{t(`fields.${k}`)}</span>
                <select className="h-11 w-full rounded-lg border bg-background px-2 text-sm" value={map[k] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value || undefined }))}>
                  <option value="">—</option>
                  {sheet.headers.filter(Boolean).map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {result ? (
            <div className="space-y-1 text-sm">
              <p className="text-success">{t("matched", { count: result.matched.length })}</p>
              {result.unmatched.length ? <p className="text-warning">{t("unmatchedRows", { count: result.unmatched.length })}</p> : null}
              {result.ambiguous.length ? <p className="text-warning">{t("ambiguous", { count: result.ambiguous.length })}</p> : null}
              {applicable.filter((m) => m.status === "success" && !m.utr).length ? <p className="text-warning">{t("needUtr")}</p> : null}
            </div>
          ) : null}
          <Button
            className="h-12"
            disabled={pending || !applicable.length}
            data-testid="apply-status"
            onClick={() =>
              start(async () => {
                const res = await applyStatusResults(
                  runId,
                  applicable.map((m) => ({ paymentId: m.paymentId, status: m.status as "success" | "failed", utr: m.utr, reason: m.reason })),
                );
                toast.success(t("applied", { count: res.applied }));
                setSheet(null);
                router.refresh();
              })
            }
          >
            {t("applyN", { count: applicable.length })}
          </Button>
        </div>
      )}
    </div>
  );
}

function Completion({ runStatus, payments, businessName, runId }: { runStatus: string; payments: RunPaymentView[]; businessName: string; runId: string }) {
  const t = useTranslations("pay.results");
  const locale = useLocale();
  const [lang, setLang] = useState<"en" | "hi">(locale === "hi" ? "hi" : "en");
  const paid = payments.filter((p) => p.status === "paid");
  const tpl = (lang === "hi" ? hi : en).pay.results.notifyMessage as string;
  return (
    <section className={cn("rounded-2xl border p-5", runStatus === "completed" ? "border-success/40 bg-success-bg" : "border-warning/40 bg-warning-bg")} data-testid="run-complete">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {runStatus === "completed" ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <AlertTriangle className="size-5 text-warning" aria-hidden />}
        {runStatus === "completed" ? t("completeTitle") : t("partlyTitle")}
      </h2>
      <p className="mt-1 text-sm">{runStatus === "completed" ? t("completeBody") : t("partlyBody")}</p>
      <Button asChild variant="outline" className="mt-4 h-12 w-full bg-card">
        <a href={`/api/runs/${runId}/paid-list`} download data-testid="export-paid">
          <FileSpreadsheet className="size-4" aria-hidden /> {t("export")}
        </a>
      </Button>
      {paid.length ? (
        <details className="mt-3 rounded-xl bg-card p-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium">
            <MessageCircle className="size-4" aria-hidden /> {t("notify")}
          </summary>
          <div className="my-2 flex gap-2">
            {(["en", "hi"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cn("min-h-9 rounded-lg border px-3 text-sm", lang === l && "border-foreground bg-foreground text-background")}>
                {l === "hi" ? "हिन्दी" : "English"}
              </button>
            ))}
          </div>
          <ul className="divide-y">
            {paid.map((p) => {
              const msg = tpl.replace("{amount}", formatInr(p.amountPaise)).replace("{invoices}", p.invoiceNumbers.join(", ")).replace("{utr}", p.utr ?? "").replace("{business}", businessName);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm">{p.vendorName}</span>
                  <Button asChild size="sm" variant="outline" className="h-10">
                    <a href={whatsappLink(p.phone, msg)} target="_blank" rel="noopener noreferrer">
                      {t("notifyOne")}
                    </a>
                  </Button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
