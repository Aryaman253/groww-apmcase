import { getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { PageHeader } from "@/components/app/page-header";
import { BankAccounts } from "./bank-accounts";

export default async function BankAccountsPage() {
  const ctx = await getAppContext();
  const t = await getTranslations("bankAccounts");
  const tm = await getTranslations("more");
  const [{ data: accounts }, { data: templates }] = await Promise.all([
    ctx.supabase.from("debit_accounts").select("id, bank_name, nickname, account_last4, ifsc, is_default, bank_template_id").eq("workspace_id", ctx.workspace.id).is("deleted_at", null).order("created_at"),
    ctx.supabase.from("bank_templates").select("id, name").is("deleted_at", null).order("is_system", { ascending: false }),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("body")} backHref="/more" backLabel={tm("title")} />
      <BankAccounts accounts={accounts ?? []} templates={templates ?? []} />
    </>
  );
}
