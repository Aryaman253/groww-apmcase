"use client";
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, ShieldCheck, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StickyBar } from "@/components/app/sticky-bar";
import { CropBox, type Crop } from "@/components/app/crop-box";
import { vendorExtractionToForm } from "./extraction-map";
import type { ExtractionHints, VendorFormValues } from "./vendor-form";

/** Photo / screenshot / cancelled cheque → on-device OCR (lazy-loaded) → parser → editable form. */
export function ImageExtract({
  onDone,
  onBack,
  onPasteInstead,
}: {
  onDone: (initial: Partial<VendorFormValues>, hints: ExtractionHints) => void;
  onBack: () => void;
  onPasteInstead: () => void;
}) {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [stage, setStage] = useState<"idle" | "loading" | "reading" | "error">("idle");

  async function run() {
    if (!file) return;
    setStage("loading");
    try {
      const ocr = await import("@/lib/ocr");
      const res = await ocr.extractVendorFromImage(file, {
        lang: locale === "hi" ? "hi" : "en",
        crop: crop ?? undefined,
        onProgress: (s: string) => setStage(s === "loading" ? "loading" : "reading"),
      });
      const mapped = vendorExtractionToForm(res);
      onDone(mapped.initial, mapped.hints);
    } catch {
      setStage("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        data-testid="vendor-image-input"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setCrop(null);
          setStage("idle");
          if (url) URL.revokeObjectURL(url);
          setUrl(f ? URL.createObjectURL(f) : null);
        }}
      />
      {url ? (
        <div className="space-y-2">
          <CropBox src={url} value={crop} onChange={setCrop} alt={t("methodImage")} />
          <p className="text-sm text-text-secondary">{t("cropHint")}</p>
        </div>
      ) : (
        <Button size="lg" variant="outline" className="h-32 flex-col gap-2 border-dashed text-base" onClick={() => inputRef.current?.click()}>
          <Camera className="size-7" aria-hidden />
          {t("takePhoto")}
        </Button>
      )}
      <p className="flex items-center gap-1.5 text-sm text-text-secondary">
        <ShieldCheck className="size-4 shrink-0" aria-hidden /> {t("onDevice")}
      </p>
      <div className="flex items-start gap-2 rounded-lg bg-secondary p-3 text-sm">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <div className="space-y-1">
          <p>{t("photoTip")}</p>
          <button type="button" className="min-h-9 font-medium underline" onClick={onPasteInstead}>
            {t("usePaste")}
          </button>
        </div>
      </div>
      {stage === "loading" || stage === "reading" ? (
        <p className="text-sm text-text-secondary" role="status" aria-live="polite">
          {stage === "loading" ? t("ocrLoading") : t("ocrRunning")}
        </p>
      ) : null}
      {stage === "error" ? (
        <p className="text-sm text-danger" role="alert">
          {t("ocrFailed")}
        </p>
      ) : null}
      <StickyBar className="flex gap-2">
        <Button variant="outline" size="lg" className="h-12" onClick={url ? () => inputRef.current?.click() : onBack}>
          {url ? t("takePhoto").split(" ")[0] : tc("back")}
        </Button>
        <Button size="lg" className="h-12 flex-1" disabled={!file || stage === "loading" || stage === "reading"} onClick={run} data-testid="vendor-image-run">
          {stage === "loading" || stage === "reading" ? t("extracting") : t("runOcr")}
        </Button>
      </StickyBar>
    </div>
  );
}
