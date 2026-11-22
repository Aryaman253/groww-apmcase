import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { getAppContext } from "@/lib/server/context";
import { paiseToDecimalString } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/** Excel of paid payments + their bills, for entry into the accounting software. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "BAD_ID" }, { status: 400 });
  const ctx = await getAppContext();
  const { data: run } = await ctx.supabase.from("payment_runs").select("run_number").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { data: pays } = await ctx.supabase
    .from("run_payments")
    .select("amount_paise, utr, method, payment_mode, resolved_at, vendors(display_name, gstin), vendor_bank_details(account_last4, ifsc, upi_id), run_payment_bills(amount_paise, bills(invoice_number, invoice_date))")
    .eq("run_id", id)
    .eq("status", "paid");
  const rows = (pays ?? []).flatMap((p) =>
    (p.run_payment_bills ?? []).map((l) => ({
      "Payment date": formatDate((p.resolved_at ?? "").slice(0, 10)),
      Vendor: p.vendors?.display_name ?? "",
      GSTIN: p.vendors?.gstin ?? "",
      "Invoice no": l.bills?.invoice_number ?? "",
      "Invoice date": formatDate(l.bills?.invoice_date ?? null),
      "Amount paid (INR)": Number(paiseToDecimalString(l.amount_paise)),
      "Payment total (INR)": Number(paiseToDecimalString(p.amount_paise)),
      "UTR / reference": p.utr ?? "",
      Method: p.method === "bank_file" ? "Bank transfer" : p.method === "upi" ? "UPI" : "Direct pay",
      Mode: p.payment_mode ?? "",
      "Paid to": p.vendor_bank_details?.account_last4 ? `A/c ••••${p.vendor_bank_details.account_last4} ${p.vendor_bank_details.ifsc ?? ""}` : (p.vendor_bank_details?.upi_id ?? ""),
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Paid");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ctx.workspace.slug}-run-${run.run_number}-paid.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
