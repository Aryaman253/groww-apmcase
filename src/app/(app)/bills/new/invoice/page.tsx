import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { pickerVendors } from "@/lib/server/picker";
import { PageHeader } from "@/components/app/page-header";
import { InvoiceCapture } from "./invoice-capture";

export default async function InvoiceBillPage() {
  const ctx = await getAppContext();
  const t = await getTranslations("bills");
  return (
    <>
      <PageHeader title={t("invoice.title")} backHref="/bills/new" backLabel={t("addTitle")} />
      <InvoiceCapture vendors={await pickerVendors(ctx)} ownGstin={ctx.workspace.gstin} keepCopy={Boolean(ctx.workspace.settings?.keepInvoiceImages)} />
    </>
  );
}
