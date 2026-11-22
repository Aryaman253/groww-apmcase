import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getAppContext } from "@/lib/server/context";
import { listVendors } from "@/lib/server/vendors";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { VendorList } from "./vendor-list";

export const metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await getAppContext();
  const t = await getTranslations("vendors");
  const vendors = await listVendors(ctx);
  const { filter } = await searchParams;
  return (
    <>
      <PageHeader
        title={t("title")}
        action={
          <Button asChild className="h-11">
            <Link href="/vendors/new">
              <Plus className="size-4" aria-hidden /> {t("add")}
            </Link>
          </Button>
        }
      />
      <VendorList
        initialFilter={filter}
        vendors={vendors.map((v) => ({
          id: v.id,
          name: v.display_name,
          last4: v.approved?.account_last4 ?? v.pending?.account_last4 ?? null,
          upi: v.approved?.upi_id ?? v.pending?.upi_id ?? null,
          status: v.displayStatus,
          duePaise: v.dueTotalPaise,
          gstin: v.gstin,
        }))}
      />
    </>
  );
}
