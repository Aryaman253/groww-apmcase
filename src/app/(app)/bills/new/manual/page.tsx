import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { pickerVendors } from "@/lib/server/picker";
import { PageHeader } from "@/components/app/page-header";
import { BillForm } from "@/components/bills/bill-form";

export default async function ManualBillPage({ searchParams }: { searchParams: Promise<{ vendor?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("bills");
  const vendors = await pickerVendors(ctx);
  const sp = await searchParams;
  return (
    <>
      <PageHeader title={t("methodManual")} backHref="/bills/new" backLabel={t("addTitle")} />
      <BillForm vendors={vendors} initial={{ vendorId: vendors.some((v) => v.id === sp.vendor) ? sp.vendor! : null }} />
    </>
  );
}
