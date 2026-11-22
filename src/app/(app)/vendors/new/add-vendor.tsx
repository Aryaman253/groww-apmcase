"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ClipboardPaste, Camera, PencilLine, Link2, ChevronRight } from "lucide-react";
import { VendorForm, type ExtractionHints, type VendorFormValues } from "@/components/vendors/vendor-form";
import { PasteExtract } from "@/components/vendors/paste-extract";
import { ImageExtract } from "@/components/vendors/image-extract";
import { RequestLinkSheet } from "@/components/vendors/request-link";

type Method = "paste" | "image" | "manual";

export function AddVendor({ initialMethod, initialName }: { initialMethod?: Method; initialName?: string }) {
  const t = useTranslations("vendors");
  const [method, setMethod] = useState<Method | null>(initialMethod ?? null);
  const [filled, setFilled] = useState<{ initial: Partial<VendorFormValues>; hints?: ExtractionHints; key: number } | null>(
    initialMethod === "manual" ? { initial: { displayName: initialName ?? "" }, key: 0 } : null,
  );

  if (filled) {
    return (
      <div className="flex flex-col gap-4">
        {method !== "manual" ? (
          <button type="button" className="min-h-11 w-fit text-sm text-text-secondary underline" onClick={() => setFilled(null)}>
            {t("usePaste")}
          </button>
        ) : null}
        <VendorForm key={filled.key} mode={{ kind: "create" }} initial={filled.initial} hints={filled.hints} />
      </div>
    );
  }

  if (method === "paste") {
    return <PasteExtract onBack={() => setMethod(null)} onDone={(initial, hints) => setFilled({ initial, hints, key: Date.now() })} />;
  }
  if (method === "image") {
    return (
      <ImageExtract
        onBack={() => setMethod(null)}
        onPasteInstead={() => setMethod("paste")}
        onDone={(initial, hints) => setFilled({ initial, hints, key: Date.now() })}
      />
    );
  }

  const options = [
    { k: "paste" as const, icon: ClipboardPaste, title: t("methodPaste"), hint: t("methodPasteHint") },
    { k: "image" as const, icon: Camera, title: t("methodImage"), hint: t("methodImageHint") },
    { k: "manual" as const, icon: PencilLine, title: t("methodManual"), hint: t("methodManualHint") },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-secondary">{t("addHow")}</p>
      {options.map(({ k, icon: Icon, title, hint }) => (
        <button
          key={k}
          type="button"
          data-testid={`vendor-method-${k}`}
          onClick={() => {
            setMethod(k);
            if (k === "manual") setFilled({ initial: {}, key: Date.now() });
          }}
          className="flex min-h-16 items-center gap-4 rounded-xl border bg-card p-4 text-left hover:bg-surface-hover"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block font-medium">{title}</span>
            <span className="block text-sm text-text-secondary">{hint}</span>
          </span>
          <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
        </button>
      ))}
      <RequestLinkSheet
        trigger={
          <button type="button" className="flex min-h-16 items-center gap-4 rounded-xl border border-dashed p-4 text-left hover:bg-surface-hover" data-testid="vendor-method-request">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
              <Link2 className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-medium">{t("methodRequest")}</span>
              <span className="block text-sm text-text-secondary">{t("methodRequestHint")}</span>
            </span>
          </button>
        }
      />
    </div>
  );
}
