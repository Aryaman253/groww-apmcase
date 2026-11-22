import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { ChangeBank } from "./change-bank";

export default async function ChangeBankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("vendors");
  const { data: v } = await ctx.supabase.from("vendors").select("id, display_name").eq("id", id).eq("workspace_id", ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!v) notFound();
  return (
    <>
      <PageHeader title={t("detail.changeBank")} backHref={`/vendors/${id}`} backLabel={v.display_name} />
      <ChangeBank vendorId={id} vendorName={v.display_name} />
    </>
  );
}
