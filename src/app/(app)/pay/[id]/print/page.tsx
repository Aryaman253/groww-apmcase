import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAppContext } from "@/lib/server/context";
import { formatInr } from "@/lib/money";
import { formatDate, todayIst } from "@/lib/dates";
import { amountInWords } from "@/lib/amount-words";
import { maskAccount } from "@/lib/validation";
import { PrintButton } from "./print-button";

export default async function RunPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  const t = await getTranslations("pay");
  const locale = await getLocale();
  const { data: run } = await ctx.supabase.from("payment_runs").select("*, debit_accounts(nickname, bank_name, account_last4)").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!run) notFound();
  const { data: pays } = await ctx.supabase
    .from("run_payments")
    .select("amount_paise, method, status, utr, remarks, vendors(display_name), vendor_bank_details(account_last4, ifsc, upi_id)")
    .eq("run_id", id)
    .order("created_at");
  return (
    <article className="mx-auto max-w-3xl bg-background p-2 text-sm print:p-0">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton label={(await getTranslations("common"))("print")} />
      </div>
      <header className="mb-4 border-b pb-3">
        <h1 className="text-xl font-semibold">{t("print.title")} — {t("runTitle", { number: run.run_number })}</h1>
        <p>{ctx.workspace.name}</p>
        <p className="text-text-secondary">
          {t(`steps.confirm`)}: {run.confirmed_at ? formatDate(run.confirmed_at.slice(0, 10), locale) : "—"} · {run.debit_accounts ? `${run.debit_accounts.nickname} ${run.debit_accounts.bank_name} ${maskAccount(run.debit_accounts.account_last4)}` : ""}
        </p>
        <p className="text-text-secondary">{t("print.generated", { date: formatDate(todayIst(), locale) })}</p>
      </header>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1.5 pr-2">#</th>
            <th className="py-1.5 pr-2">{t("print.vendor")}</th>
            <th className="py-1.5 pr-2">{t("print.account")}</th>
            <th className="py-1.5 pr-2">{t("print.method")}</th>
            <th className="py-1.5 pr-2 text-right">₹</th>
            <th className="py-1.5 pr-2">{t("print.utr")}</th>
            <th className="py-1.5">{t("print.status")}</th>
          </tr>
        </thead>
        <tbody>
          {(pays ?? []).map((p, i) => (
            <tr key={i} className="border-b align-top">
              <td className="py-1.5 pr-2">{i + 1}</td>
              <td className="py-1.5 pr-2">
                {p.vendors?.display_name}
                <div className="text-xs text-text-secondary">{p.remarks}</div>
              </td>
              <td className="tabular py-1.5 pr-2">{p.vendor_bank_details?.account_last4 ? `${maskAccount(p.vendor_bank_details.account_last4)} ${p.vendor_bank_details.ifsc ?? ""}` : p.vendor_bank_details?.upi_id}</td>
              <td className="py-1.5 pr-2">{t(`review.methods.${p.method}`)}</td>
              <td className="tabular py-1.5 pr-2 text-right">{formatInr(p.amount_paise)}</td>
              <td className="tabular py-1.5 pr-2">{p.utr ?? ""}</td>
              <td className="py-1.5">{t(`payStep.direct.status.${p.status}`)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={4} className="py-2">{t("confirm.total")}</td>
            <td className="tabular py-2 pr-2 text-right">{formatInr(run.total_paise)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
      <p className="mt-2">{amountInWords(run.total_paise, "en")}</p>
      <p lang="hi">{amountInWords(run.total_paise, "hi")}</p>
      <p className="mt-10 w-64 border-t pt-1 text-text-secondary">{t("print.signature")}</p>
    </article>
  );
}
