import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { AddVendor } from "./add-vendor";

export default async function NewVendorPage({ searchParams }: { searchParams: Promise<{ manual?: string; name?: string; method?: string }> }) {
  const t = await getTranslations("vendors");
  const sp = await searchParams;
  return (
    <>
      <PageHeader title={t("addTitle")} backHref="/vendors" backLabel={t("title")} />
      <AddVendor initialMethod={sp.manual ? "manual" : (sp.method as "paste" | "image" | undefined)} initialName={sp.name} />
    </>
  );
}
