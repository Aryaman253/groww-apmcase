import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { VendorForm } from "@/components/vendors/vendor-form";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("vendors");
  const { data: v } = await ctx.supabase.from("vendors").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!v) notFound();
  return (
    <>
      <PageHeader title={t("detail.editProfile")} backHref={`/vendors/${id}`} backLabel={v.display_name} />
      <VendorForm
        mode={{ kind: "profile", vendorId: id }}
        initial={{
          displayName: v.display_name,
          legalName: v.legal_name ?? "",
          gstin: v.gstin ?? "",
          phone: v.phone ?? "",
          email: v.email ?? "",
          creditDays: String(v.credit_days),
          notes: v.notes ?? "",
        }}
      />
    </>
  );
}
