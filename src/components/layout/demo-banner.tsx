import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function DemoBanner() {
  const t = await getTranslations("demo");
  return (
    <div className="no-print border-b bg-bg-secondary">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 text-sm">
        <span className="text-text-secondary">{t("banner")}</span>
        <Link href="/more/settings#demo" className="font-medium underline-offset-4 hover:underline">
          {t("reset")}
        </Link>
      </div>
    </div>
  );
}
