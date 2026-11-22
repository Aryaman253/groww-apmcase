"use client";
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, ShieldCheck, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BillForm, type BillFormValues, type BillHints } from "@/components/bills/bill-form";
import type { PickerVendor } from "@/components/bills/vendor-picker";
import type { ExtractionResult, InvoiceExtraction } from "@/lib/extract/types";
import { paiseToDecimalString } from "@/lib/money";

function toForm(res: ExtractionResult<InvoiceExtraction>): { initial: Partial<BillFormValues>; hints: BillHints } {
  const f = res.fields;
  const initial: Partial<BillFormValues> = {
    invoiceNumber: f.invoiceNumber.value ?? "",
    invoiceDate: f.invoiceDate.value ?? "",
    dueDate: f.dueDate.value ?? "",
    amount: f.totalPaise.value ? paiseToDecimalString(f.totalPaise.value) : "",
    gstin: f.vendorGstin.value ?? "",
    vendorNameHint: f.vendorName.value ?? "",
  };
  const c = (x: { value: unknown; confidence: number }) => (x.value ? x.confidence : 0);
  return {
    initial,
    hints: {
      sourceType: res.meta.sourceType === "pdf" ? "pdf" : "image",
      engine: res.meta.engine,
      parserVersion: res.meta.parserVersion,
      durationMs: Math.round(res.meta.ms),
      confidence: { invoiceNumber: c(f.invoiceNumber), invoiceDate: c(f.invoiceDate), dueDate: c(f.dueDate), amount: c(f.totalPaise), gstin: c(f.vendorGstin), vendor: c(f.vendorName) },
      candidates: {},
    },
  };
}

/** Invoice photo or PDF → on-device OCR / PDF text layer → parser → editable bill form. Not uploaded. */
export function InvoiceCapture({ vendors, ownGstin, keepCopy }: { vendors: PickerVendor[]; ownGstin: string | null; keepCopy: boolean }) {
  const t = useTranslations("bills.invoice");
  const tv = useTranslations("vendors");
  const locale = useLocale();
  const ref = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"idle" | "loading" | "reading" | "error" | "paste">("idle");
  const [result, setResult] = useState<{ initial: Partial<BillFormValues>; hints: BillHints; key: number } | null>(null);
  const [pasted, setPasted] = useState("");

  async function run(file: File) {
    setStage("loading");
    try {
      const ocr = await import("@/lib/ocr");
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const opts = { lang: (locale === "hi" ? "hi" : "en") as "en" | "hi", ownGstin, onProgress: (s: string) => setStage(s === "loading" ? "loading" : "reading") };
      const res = isPdf ? await ocr.extractInvoiceFromPdf(file, opts) : await ocr.extractInvoiceFromImage(file, opts);
      setResult({ ...toForm(res), key: Date.now() });
      setStage("idle");
    } catch {
      setStage("error");
    }
  }

  if (result) return <BillForm key={result.key} vendors={vendors} initial={result.initial} hints={result.hints} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-secondary">{t("body")}</p>
      <input ref={ref} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" data-testid="invoice-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); }} />
      <Button size="lg" variant="outline" className="h-32 flex-col gap-2 border-dashed text-base" onClick={() => ref.current?.click()} disabled={stage === "loading" || stage === "reading"}>
        <Camera className="size-7" aria-hidden /> {t("choose")}
      </Button>
      <p className="flex items-center gap-1.5 text-sm text-text-secondary"><ShieldCheck className="size-4" aria-hidden /> {tv("onDevice")}</p>
      {keepCopy ? <p className="text-xs text-text-secondary">{t("keepCopy")}</p> : null}
      {stage === "loading" || stage === "reading" ? <p role="status" className="text-sm text-text-secondary">{stage === "loading" ? tv("ocrLoading") : t("reading")}</p> : null}
      {stage === "error" ? <p role="alert" className="text-sm text-danger">{t("noText")}</p> : null}
      <div className="flex items-start gap-2 rounded-lg bg-secondary p-3 text-sm">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <div className="w-full space-y-2">
          <p>{tv("photoTip")}</p>
          {stage === "paste" ? (
            <>
              <Textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} className="bg-background" />
              <Button className="h-11" disabled={!pasted.trim()} onClick={async () => { const ocr = await import("@/lib/ocr"); const r = await ocr.extractInvoiceFromText(pasted, { ownGstin }); setResult({ ...toForm(r), key: Date.now() }); }}>{tv("extract")}</Button>
            </>
          ) : (
            <button type="button" className="min-h-9 font-medium underline" onClick={() => setStage("paste")}>{tv("usePaste")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
