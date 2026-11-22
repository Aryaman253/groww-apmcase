import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/crypto";
import { VendorRequestForm } from "./request-form";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export const metadata = { title: "Share bank details", robots: { index: false, follow: false } };

export default async function VendorRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("vendorRequest");
  const db = createAdminClient();
  const { data: req } = token.length >= 20 && token.length <= 64
    ? await db.from("vendor_requests").select("workspace_id, vendor_id, expires_at, used_at").eq("token_hash", sha256(token)).maybeSingle()
    : { data: null };
  const valid = req && !req.used_at && new Date(req.expires_at) > new Date();
  let business = "";
  let vendorName: string | null = null;
  if (valid) {
    const [{ data: ws }, { data: v }] = await Promise.all([
      db.from("workspaces").select("name").eq("id", req.workspace_id).maybeSingle(),
      req.vendor_id ? db.from("vendors").select("display_name").eq("id", req.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    business = ws?.name ?? "";
    vendorName = v?.display_name ?? null;
  }
  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-10">
      <header className="flex items-center justify-between py-4">
        <Wordmark />
        <LanguageSwitcher compact />
      </header>
      {valid ? (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="text-text-secondary">{t("intro", { business })}</p>
            {vendorName ? <p className="text-sm font-medium">{t("forVendor", { name: vendorName })}</p> : null}
          </div>
          <VendorRequestForm token={token} business={business} askName={!vendorName} />
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("secure")}
          </p>
        </>
      ) : (
        <div className="space-y-2 py-10">
          <h1 className="text-2xl font-semibold">{t("invalidTitle")}</h1>
          <p className="text-text-secondary">{t("invalidBody")}</p>
        </div>
      )}
    </main>
  );
}
