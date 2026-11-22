import { getTranslations } from "next-intl/server";
import { FileSpreadsheet, Camera, PencilLine } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ChoiceCard } from "@/components/app/choice-card";

export default async function NewBillChooser() {
  const t = await getTranslations("bills");
  const tc = await getTranslations("common");
  return (
    <>
      <PageHeader title={t("addTitle")} backHref="/bills" backLabel={t("title")} />
      <div className="flex flex-col gap-3">
        <ChoiceCard href="/bills/import" icon={FileSpreadsheet} title={t("methodImport")} hint={t("methodImportHint")} testId="bill-method-import" />
        <ChoiceCard href="/bills/new/invoice" icon={Camera} title={t("methodInvoice")} hint={t("methodInvoiceHint")} testId="bill-method-invoice" />
        <ChoiceCard href="/bills/new/manual" icon={PencilLine} title={t("methodManual")} hint={t("methodManualHint")} testId="bill-method-manual" />
      </div>
      <span className="sr-only">{tc("optional")}</span>
    </>
  );
}
