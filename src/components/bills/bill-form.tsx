"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, highlightClass } from "@/components/app/field";
import { StickyBar } from "@/components/app/sticky-bar";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { VendorPicker, type PickerVendor } from "./vendor-picker";
import { createBill, updateBill } from "@/app/(app)/bills/actions";
import { logExtraction } from "@/app/(app)/vendors/actions";
import { computeDueDate, formatDate } from "@/lib/dates";
import { formatInr, parseAmountToPaise, paiseToDecimalString } from "@/lib/money";
import { isValidGstin } from "@/lib/validation";
import { matchVendor } from "@/lib/payments";

export type BillFormValues = {
  vendorId: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: string;
  gstin: string;
  notes: string;
  vendorNameHint?: string;
};

export type BillHints = {
  sourceType: "image" | "pdf";
  engine?: string;
  parserVersion: string;
  durationMs?: number;
  confidence: Partial<Record<"invoiceNumber" | "invoiceDate" | "dueDate" | "amount" | "gstin" | "vendor", number>>;
  candidates: Partial<Record<"invoiceNumber" | "invoiceDate" | "dueDate" | "amount" | "gstin", string[]>>;
};

type Dup = { billId: string; invoiceNumber: string; amountPaise: number; invoiceDate: string | null; reason: "same_invoice_number" | "same_amount_and_date" };

export function BillForm({
  vendors,
  initial,
  hints,
  billId,
}: {
  vendors: PickerVendor[];
  initial?: Partial<BillFormValues>;
  hints?: BillHints;
  billId?: string;
}) {
  const t = useTranslations("bills");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  // Vendor matching for extracted invoices: GSTIN → exact name → suggestions (never auto-assign fuzzy).
  const match = !initial?.vendorId && (initial?.gstin || initial?.vendorNameHint)
    ? matchVendor({ gstin: initial?.gstin ?? null, name: initial?.vendorNameHint ?? "" }, vendors.map((v) => ({ ...v })))
    : null;
  const [v, setV] = useState<BillFormValues>({
    vendorId: initial?.vendorId ?? match?.match?.id ?? null,
    invoiceNumber: initial?.invoiceNumber ?? "",
    invoiceDate: initial?.invoiceDate ?? "",
    dueDate: initial?.dueDate ?? "",
    amount: initial?.amount ?? "",
    gstin: initial?.gstin ?? "",
    notes: initial?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<Dup[] | null>(null);
  const vendor = vendors.find((x) => x.id === v.vendorId);
  const computedDue = computeDueDate({ invoiceDate: v.invoiceDate || null, creditDays: vendor?.creditDays ?? 30 });
  const set = (k: keyof BillFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const low = (k: keyof BillHints["confidence"]) => (hints?.confidence[k] ?? 1) < 0.8;

  function submit(allowDuplicate = false) {
    const errs: Record<string, string> = {};
    const amountPaise = parseAmountToPaise(v.amount);
    if (!v.vendorId) errs.vendorId = "vendor";
    if (!v.invoiceNumber.trim()) errs.invoiceNumber = "required";
    if (!amountPaise || amountPaise <= 0) errs.amount = "amount";
    if (!v.dueDate && !v.invoiceDate) errs.dueDate = t("form.needDueOrInvoiceDate");
    if (v.gstin && !isValidGstin(v.gstin)) errs.gstin = "gstin";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = {
      vendorId: v.vendorId!,
      invoiceNumber: v.invoiceNumber,
      invoiceDate: v.invoiceDate || undefined,
      dueDate: v.dueDate || undefined,
      amountPaise: amountPaise!,
      gstin: v.gstin || undefined,
      notes: v.notes || undefined,
      source: hints ? (hints.sourceType === "pdf" ? ("invoice_pdf" as const) : ("invoice_image" as const)) : ("manual" as const),
      allowDuplicate,
    };
    start(async () => {
      const res = billId ? await updateBill(billId, payload) : await createBill(payload);
      if (!res.ok) {
        if (res.error === "DUPLICATE" && "duplicates" in res && res.duplicates) {
          setDups(res.duplicates);
          return;
        }
        if (res.fieldErrors) {
          setErrors(Object.fromEntries(Object.entries(res.fieldErrors).map(([k, m]) => [k === "dueDate" && m === "needDueOrInvoiceDate" ? "dueDate" : k, m === "needDueOrInvoiceDate" ? t("form.needDueOrInvoiceDate") : m])));
        } else toast.error(tc("somethingWrong"));
        return;
      }
      if (hints && initial) {
        const fields = ["invoiceNumber", "invoiceDate", "dueDate", "amount", "gstin"] as const;
        void logExtraction({
          kind: "invoice",
          sourceType: hints.sourceType,
          engine: hints.engine,
          parserVersion: hints.parserVersion,
          durationMs: hints.durationMs,
          fields: Object.fromEntries(fields.map((f) => [f, { confidence: hints.confidence[f] ?? 0, present: Boolean(initial[f]) }])),
          correctedFields: fields.filter((f) => (initial[f] ?? "") !== (v[f] ?? "")),
        });
      }
      toast.success(t("form.saved"));
      setDups(null);
      router.push(billId ? `/bills/${billId}` : "/bills");
      router.refresh();
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
      data-testid="bill-form"
    >
      <Field id="vendor" label={t("form.vendor")} error={errors.vendorId}>
        <VendorPicker
          id="vendor"
          vendors={vendors}
          value={v.vendorId}
          invalid={Boolean(errors.vendorId)}
          onChange={(id) => setV((s) => ({ ...s, vendorId: id }))}
          onCreate={(name) => router.push(`/vendors/new?manual=1&name=${encodeURIComponent(name)}`)}
        />
      </Field>
      {match?.match && match.kind ? (
        <p className="-mt-2 text-sm text-success">
          {match.kind === "gstin" ? t("form.matchedByGstin", { name: match.match.name }) : t("form.matchedByName", { name: match.match.name })}
        </p>
      ) : null}
      {match && !match.match && match.suggestions.length && !v.vendorId ? (
        <div className="-mt-1 flex flex-col gap-2 rounded-lg bg-warning-bg/50 p-3">
          <span className="text-sm text-warning">{t("form.suggestions")}</span>
          <div className="flex flex-wrap gap-2">
            {match.suggestions.map((s) => (
              <button key={s.vendor.id} type="button" className="min-h-11 rounded-lg border bg-card px-3 text-sm hover:bg-surface-hover" onClick={() => setV((x) => ({ ...x, vendorId: s.vendor.id }))}>
                {t("form.confirmVendor", { name: s.vendor.name })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <Field id="invoiceNumber" label={t("form.invoiceNumber")} error={errors.invoiceNumber} >
        <Input id="invoiceNumber" value={v.invoiceNumber} onChange={set("invoiceNumber")} className={highlightClass(Boolean(hints && low("invoiceNumber")), Boolean(errors.invoiceNumber))} />
      </Field>
      <Field id="amount" label={t("form.amount")} error={errors.amount}>
        <Input id="amount" inputMode="decimal" value={v.amount} onChange={set("amount")} className={`tabular ${highlightClass(Boolean(hints && low("amount")), Boolean(errors.amount))}`} data-testid="bill-amount" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="invoiceDate" label={t("form.invoiceDate")}>
          <Input id="invoiceDate" type="date" value={v.invoiceDate} onChange={set("invoiceDate")} className={highlightClass(Boolean(hints && low("invoiceDate")))} />
        </Field>
        <Field id="dueDate" label={t("form.dueDate")} error={errors.dueDate}>
          <Input id="dueDate" type="date" value={v.dueDate} onChange={set("dueDate")} className={highlightClass(Boolean(hints && low("dueDate")), Boolean(errors.dueDate))} />
        </Field>
      </div>
      {!v.dueDate ? (
        <p className="-mt-2 text-sm text-text-secondary">
          {computedDue && vendor
            ? t("form.dueDateHint", { days: vendor.creditDays, date: formatDate(computedDue, locale) })
            : t("form.dueDateHintNoInvoice")}
        </p>
      ) : null}
      <details className="rounded-xl border bg-card p-4" open={Boolean(v.gstin || v.notes)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center font-medium">{tc("moreDetails")}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field id="gstin" label={t("form.gstin")} optional error={errors.gstin}>
            <Input id="gstin" value={v.gstin} onChange={(e) => setV((s) => ({ ...s, gstin: e.target.value.toUpperCase().trim() }))} maxLength={15} className={highlightClass(Boolean(hints && low("gstin")), Boolean(errors.gstin))} />
          </Field>
          <Field id="notes" label={t("form.notes")} optional>
            <Textarea id="notes" rows={3} value={v.notes} onChange={set("notes")} />
          </Field>
        </div>
      </details>
      <StickyBar>
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending} data-testid="bill-save">
          {pending ? tc("saving") : t("form.save")}
        </Button>
      </StickyBar>

      <Drawer open={Boolean(dups)} onOpenChange={(o) => !o && setDups(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" aria-hidden /> {t("duplicate.title")}
            </DrawerTitle>
            <DrawerDescription asChild>
              <div className="space-y-2">
                {(dups ?? []).map((d) => (
                  <p key={d.billId}>
                    {t(`duplicate.${d.reason}`, {
                      vendor: vendor?.name ?? "",
                      number: d.invoiceNumber,
                      amount: formatInr(d.amountPaise),
                      date: formatDate(d.invoiceDate, locale),
                    })}
                  </p>
                ))}
              </div>
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="pb-safe">
            <Button size="lg" className="h-12" onClick={() => setDups(null)}>
              {tc("cancel")}
            </Button>
            <Button size="lg" variant="outline" className="h-12" onClick={() => submit(true)} disabled={pending} data-testid="save-anyway">
              {t("duplicate.saveAnyway")}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </form>
  );
}

export function paiseToInput(paise: number) {
  return paiseToDecimalString(paise);
}
