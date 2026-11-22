"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { VendorForm, type ExtractionHints, type VendorFormValues } from "@/components/vendors/vendor-form";
import { PasteExtract } from "@/components/vendors/paste-extract";
import { ImageExtract } from "@/components/vendors/image-extract";
import { cn } from "@/lib/utils";

export function ChangeBank({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const t = useTranslations("vendors");
  const [method, setMethod] = useState<"manual" | "paste" | "image">("manual");
  const [filled, setFilled] = useState<{ initial: Partial<VendorFormValues>; hints?: ExtractionHints; key: number } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1" role="tablist">
        {(["manual", "paste", "image"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={method === m}
            onClick={() => {
              setMethod(m);
              setFilled(null);
            }}
            className={cn("min-h-11 rounded-lg text-sm", method === m ? "bg-card font-medium shadow-xs" : "text-text-secondary")}
          >
            {m === "manual" ? t("methodManual") : m === "paste" ? t("methodPaste") : t("methodImage")}
          </button>
        ))}
      </div>
      {method === "manual" || filled ? (
        <VendorForm key={filled?.key ?? 0} mode={{ kind: "bank", vendorId, vendorName }} initial={filled?.initial} hints={filled?.hints} />
      ) : method === "paste" ? (
        <PasteExtract onBack={() => setMethod("manual")} onDone={(initial, hints) => setFilled({ initial, hints, key: Date.now() })} />
      ) : (
        <ImageExtract onBack={() => setMethod("manual")} onPasteInstead={() => setMethod("paste")} onDone={(initial, hints) => setFilled({ initial, hints, key: Date.now() })} />
      )}
    </div>
  );
}
