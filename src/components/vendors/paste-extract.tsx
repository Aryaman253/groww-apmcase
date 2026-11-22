"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StickyBar } from "@/components/app/sticky-bar";
import { parseVendorText, PARSER_VERSION } from "@/lib/extract/parser";
import { vendorExtractionToForm } from "./extraction-map";
import type { ExtractionHints, VendorFormValues } from "./vendor-form";

/** Paste a WhatsApp/SMS/email message → deterministic on-device parser → editable form. */
export function PasteExtract({ onDone, onBack, initialText = "" }: { onDone: (initial: Partial<VendorFormValues>, hints: ExtractionHints) => void; onBack: () => void; initialText?: string }) {
  const t = useTranslations("vendors");
  const tc = useTranslations("common");
  const [text, setText] = useState(initialText);
  const [nothing, setNothing] = useState(false);

  function run() {
    const start = performance.now();
    const fields = parseVendorText(text);
    const res = vendorExtractionToForm({
      fields,
      text: "",
      meta: { parserVersion: PARSER_VERSION, sourceType: "paste", ms: performance.now() - start, textLength: text.length },
    });
    if (!res.found) {
      setNothing(true);
    }
    onDone(res.initial, res.hints);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="paste">{t("pasteLabel")}</Label>
        <Textarea
          id="paste"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("pastePlaceholder")}
          className="text-base"
          data-testid="paste-text"
        />
        <p className="flex items-center gap-1.5 text-sm text-text-secondary">
          <ShieldCheck className="size-4" aria-hidden /> {t("onDevice")}
        </p>
        {nothing ? <p className="text-sm text-warning">{t("nothingFound")}</p> : null}
      </div>
      <StickyBar className="flex gap-2">
        <Button variant="outline" size="lg" className="h-12" onClick={onBack}>
          {tc("back")}
        </Button>
        <Button size="lg" className="h-12 flex-1" disabled={!text.trim()} onClick={run} data-testid="paste-extract">
          {t("extract")}
        </Button>
      </StickyBar>
    </div>
  );
}
