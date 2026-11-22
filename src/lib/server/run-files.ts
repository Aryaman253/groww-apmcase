import "server-only";
import type { AppContext } from "./context";
import { decrypt } from "@/lib/crypto";
import { GENERIC_CSV_TEMPLATE, validateRun, generateBankFile, type BankFileInput } from "@/lib/bankfile";
import { paymentReference } from "@/lib/payments";
import { todayIst } from "@/lib/dates";

/** Builds the bank-file input for a run's bank_file payments (decrypts accounts server-side only). */
export async function buildBankFileInput(ctx: AppContext, runId: string): Promise<{ input: BankFileInput; isPlaceholder: boolean } | null> {
  const ws = ctx.workspace.id;
  const { data: run } = await ctx.supabase
    .from("payment_runs")
    .select("id, run_number, debit_account_id, status")
    .eq("id", runId)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!run || run.status === "draft" || !run.debit_account_id) return null;
  const [{ data: debit }, { data: pays }] = await Promise.all([
    ctx.supabase.from("debit_accounts").select("account_number_enc, ifsc, bank_template_id").eq("id", run.debit_account_id).single(),
    ctx.supabase
      .from("run_payments")
      .select("id, vendor_id, amount_paise, remarks, warnings, status, bank_detail_id, vendors(display_name, status, email, phone), vendor_bank_details(account_number_enc, ifsc, status, upi_id, account_holder_name)")
      .eq("run_id", runId)
      .eq("method", "bank_file")
      .in("status", ["pending", "sent"]),
  ]);
  let template: unknown = GENERIC_CSV_TEMPLATE;
  let isPlaceholder = false;
  if (debit?.bank_template_id) {
    const { data: tpl } = await ctx.supabase.from("bank_templates").select("config").eq("id", debit.bank_template_id).maybeSingle();
    if (tpl) {
      template = tpl.config;
      isPlaceholder = Boolean((tpl.config as { isPlaceholder?: boolean })?.isPlaceholder);
    }
  }
  const shortId = `R${String(run.run_number).padStart(4, "0")}`;
  const payments = (pays ?? []).map((p) => {
    const d = p.vendor_bank_details;
    const warnings = Array.isArray(p.warnings) ? (p.warnings as string[]) : [];
    return {
      id: p.id,
      vendorId: p.vendor_id,
      // Account holder name as registered at the bank is what the file needs.
      vendorName: d?.account_holder_name || p.vendors?.display_name || "",
      verified: p.vendors?.status === "verified",
      bankDetailsApproved: d?.status === "approved",
      accountNumber: d?.account_number_enc ? decrypt(d.account_number_enc) : "",
      ifsc: d?.ifsc ?? "",
      amountPaise: p.amount_paise,
      remarks: `${paymentReference(shortId, p.id).slice(0, 12)} ${p.remarks ?? ""}`.trim(),
      email: p.vendors?.email,
      phone: p.vendors?.phone,
      isNewPayee: warnings.includes("NEW_PAYEE"),
    };
  });
  return {
    isPlaceholder,
    input: {
      template,
      workspaceSlug: ctx.workspace.slug,
      runId,
      runShortId: shortId,
      date: todayIst(),
      debitAccountNumber: debit?.account_number_enc ? decrypt(debit.account_number_enc) : "",
      debitIfsc: debit?.ifsc,
      runTotalPaise: payments.reduce((s, p) => s + p.amountPaise, 0),
      payments,
    },
  };
}

export { validateRun, generateBankFile };
