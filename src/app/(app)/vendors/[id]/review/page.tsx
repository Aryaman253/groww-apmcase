import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { listVendors } from "@/lib/server/vendors";
import { PageHeader } from "@/components/app/page-header";
import { ReviewPanel } from "./review-panel";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("vendors");
  const [vendor] = await listVendors(ctx, { ids: [id] });
  if (!vendor) notFound();
  if (!vendor.pending) {
    return (
      <>
        <PageHeader title={t("review.title")} backHref={`/vendors/${id}`} backLabel={vendor.display_name} />
        <p className="text-text-secondary">{t("review.nothingPending")}</p>
      </>
    );
  }
  const pick = (d: typeof vendor.approved) =>
    d && {
      id: d.id,
      holder: d.account_holder_name,
      last4: d.account_last4,
      ifsc: d.ifsc,
      bank: [d.bank_name, d.branch].filter(Boolean).join(" · ") || null,
      upi: d.upi_id,
      source: d.source,
      createdAt: d.created_at,
    };
  return (
    <>
      <PageHeader title={t("review.title")} backHref={`/vendors/${id}`} backLabel={vendor.display_name} />
      <ReviewPanel
        vendorId={id}
        vendorName={vendor.display_name}
        legalName={vendor.legal_name}
        oldDetails={pick(vendor.approved)}
        newDetails={pick(vendor.pending)!}
        hold24h={Boolean(ctx.workspace.settings?.hold24h)}
      />
    </>
  );
}
