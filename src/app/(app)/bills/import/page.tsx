import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { pickerVendors } from "@/lib/server/picker";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const ctx = await getAppContext();
  const t = await getTranslations("bills");
  const [vendors, { data: bills }, { data: presets }] = await Promise.all([
    pickerVendors(ctx),
    ctx.supabase.from("bills").select("id, vendor_id, invoice_number, invoice_date, amount_paise").eq("workspace_id", ctx.workspace.id).is("deleted_at", null),
    ctx.supabase.from("import_presets").select("name, mapping").eq("workspace_id", ctx.workspace.id).order("name"),
  ]);
  return (
    <>
      <PageHeader title={t("import.title")} backHref="/bills/new" backLabel={t("addTitle")} />
      <ImportWizard
        vendors={vendors}
        existingBills={(bills ?? []).map((b) => ({ id: b.id, vendorId: b.vendor_id, invoiceNumber: b.invoice_number, invoiceDate: b.invoice_date, amountPaise: b.amount_paise }))}
        presets={(presets ?? []).map((p) => ({ name: p.name, mapping: p.mapping as Record<string, string> }))}
      />
    </>
  );
}
