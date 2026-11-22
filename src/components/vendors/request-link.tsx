"use client";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { createVendorRequest } from "@/app/(app)/vendors/actions";
import { whatsappLink } from "@/lib/payments";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/** Creates a single-use, 7-day link and shares it by WhatsApp (Hindi or English text) or copy. */
export function RequestLinkSheet({ trigger, vendorId, phone, businessName }: { trigger: React.ReactNode; vendorId?: string; phone?: string | null; businessName?: string }) {
  const t = useTranslations("vendors.request");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [lang, setLang] = useState<"en" | "hi">(locale === "hi" ? "hi" : "en");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [pending, start] = useTransition();
  const template = (lang === "hi" ? hi : en).vendors.request.message as string;
  const message = link ? template.replace("{business}", businessName ?? "TArrow").replace("{url}", link.url) : "";

  return (
    <Drawer onOpenChange={(o) => !o && setLink(null)}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("title")}</DrawerTitle>
          <DrawerDescription>{t("body")}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-3 px-4">
          <fieldset className="flex items-center gap-2">
            <legend className="mb-2 text-sm text-text-secondary">{t("language")}</legend>
            {(["en", "hi"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cn("min-h-11 rounded-lg border px-4", lang === l ? "border-foreground bg-foreground text-background" : "bg-card")}
              >
                {l === "hi" ? "हिन्दी" : "English"}
              </button>
            ))}
          </fieldset>
          {link ? <p className="text-sm text-text-secondary">{t("expires", { date: formatDate(link.expiresAt.slice(0, 10), locale) })}</p> : null}
        </div>
        <DrawerFooter className="pb-safe">
          {link ? (
            <>
              <Button asChild size="lg" className="h-12">
                <a href={whatsappLink(phone ?? "", message)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-5" aria-hidden /> {t("share")}
                </a>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12"
                onClick={async () => {
                  await navigator.clipboard.writeText(message);
                  toast.success(tc("copied"));
                }}
              >
                <Copy className="size-5" aria-hidden /> {t("copyLink")}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              className="h-12"
              disabled={pending}
              data-testid="create-request-link"
              onClick={() =>
                start(async () => {
                  const res = await createVendorRequest({ vendorId, lang });
                  if (res.ok && res.data) setLink(res.data);
                  else toast.error(tc("somethingWrong"));
                })
              }
            >
              {t("create")}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
