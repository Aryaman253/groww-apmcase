import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { todayIst } from "@/lib/dates";
import { BillList, type BillItem } from "./bill-list";

export const metadata = { title: "Bills" };

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ tab?: string; vendor?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("bills");
  const sp = await searchParams;
  const [{ data: bills }, { data: vendors }] = await Promise.all([
    ctx.supabase
      .from("bills")
      .select("id, vendor_id, invoice_number, invoice_date, due_date, amount_paise, paid_paise, status, paid_at, paid_reference")
      .eq("workspace_id", ctx.workspace.id)
      .is("deleted_at", null)
      .order("due_date", { ascending: true })
      .limit(2000),
    ctx.supabase.from("vendors").select("id, display_name").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("display_name"),
  ]);
  const names = new Map((vendors ?? []).map((v) => [v.id, v.display_name]));
  const today = todayIst();
  const items: BillItem[] = (bills ?? []).map((b) => ({
    id: b.id,
    vendorId: b.vendor_id,
    vendorName: names.get(b.vendor_id) ?? "—",
    invoiceNumber: b.invoice_number,
    invoiceDate: b.invoice_date,
    dueDate: b.due_date,
    amountPaise: b.amount_paise,
    paidPaise: b.paid_paise,
    paidAt: b.paid_at,
    tab: b.status === "due" ? (b.due_date < today ? "overdue" : "due") : (b.status as BillItem["tab"]),
  }));
  return (
    <>
      <PageHeader
        title={t("title")}
        action={
          <Button asChild className="h-11">
            <Link href="/bills/new">
              <Plus className="size-4" aria-hidden /> {t("add")}
            </Link>
          </Button>
        }
      />
      <BillList bills={items} vendors={(vendors ?? []).map((v) => ({ id: v.id, name: v.display_name }))} today={today} initialTab={sp.tab} initialVendor={sp.vendor} />
    </>
  );
}
