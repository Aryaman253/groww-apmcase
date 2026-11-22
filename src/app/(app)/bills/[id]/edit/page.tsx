import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { pickerVendors } from "@/lib/server/picker";
import { PageHeader } from "@/components/app/page-header";
import { BillForm } from "@/components/bills/bill-form";
import { paiseToDecimalString } from "@/lib/money";

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("bills");
  const { data: bill } = await ctx.supabase.from("bills").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!bill) notFound();
  return (
    <>
      <PageHeader title={t("actions.edit")} backHref={`/bills/${id}`} backLabel={t("detail.title")} />
      <BillForm
        billId={id}
        vendors={await pickerVendors(ctx)}
        initial={{
          vendorId: bill.vendor_id,
          invoiceNumber: bill.invoice_number,
          invoiceDate: bill.invoice_date ?? "",
          dueDate: bill.due_date,
          amount: paiseToDecimalString(bill.amount_paise),
          gstin: bill.gstin ?? "",
          notes: bill.notes ?? "",
        }}
      />
    </>
  );
}
