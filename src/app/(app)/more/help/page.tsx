import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";

export default async function HelpPage() {
  const t = await getTranslations("help");
  const tm = await getTranslations("more");
  const items = t.raw("items") as { q: string; a: string }[];
  return (
    <>
      <PageHeader title={t("title")} backHref="/more" backLabel={tm("title")} />
      <div className="flex flex-col gap-2">
        {items.map((i) => (
          <details key={i.q} className="rounded-xl border bg-card px-4 py-1">
            <summary className="flex min-h-12 cursor-pointer list-none items-center font-medium">{i.q}</summary>
            <p className="pb-3 text-text-secondary">{i.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-6 text-sm text-text-secondary">{t("contact")}</p>
    </>
  );
}
