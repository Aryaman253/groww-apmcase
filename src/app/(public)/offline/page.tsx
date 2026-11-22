import { getTranslations } from "next-intl/server";
import { WifiOff } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";

export const dynamic = "force-static";

export default async function OfflinePage() {
  const t = await getTranslations("common");
  return (
    <>
      <header className="py-4"><Wordmark /></header>
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <WifiOff className="size-8 text-text-secondary" aria-hidden />
        <p>{t("offline")}</p>
      </section>
    </>
  );
}
