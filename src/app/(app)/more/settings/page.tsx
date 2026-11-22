import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getAppContext();
  const t = await getTranslations("settings");
  const tm = await getTranslations("more");
  const [{ data: prov }, { data: templates }] = await Promise.all([
    ctx.supabase.from("payout_providers").select("provider, status, uses_app_demo_keys, account_number, last_checked_at").eq("workspace_id", ctx.workspace.id).maybeSingle(),
    ctx.supabase.from("bank_templates").select("id, name, config, workspace_id, is_system").is("deleted_at", null).order("is_system", { ascending: false }),
  ]);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return (
    <>
      <PageHeader title={t("title")} backHref="/more" backLabel={tm("title")} />
      <SettingsForms
        workspace={{
          name: ctx.workspace.name,
          legal_name: ctx.workspace.legal_name,
          gstin: ctx.workspace.gstin,
          phone: ctx.workspace.phone,
          email: ctx.workspace.email,
          address: ctx.workspace.address,
          is_demo: ctx.workspace.is_demo,
        }}
        settings={ctx.workspace.settings ?? {}}
        provider={prov ? { provider: prov.provider, status: prov.status, demo: prov.uses_app_demo_keys, account: prov.account_number } : null}
        webhookBase={`${appUrl}/api/webhooks`}
        templates={(templates ?? []).map((tp) => ({ id: tp.id, name: tp.name, editable: tp.workspace_id !== null, json: JSON.stringify(tp.config, null, 2), placeholder: Boolean((tp.config as { isPlaceholder?: boolean })?.isPlaceholder) }))}
      />
    </>
  );
}
