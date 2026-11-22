import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { getAppContext } from "@/lib/server/context";
import { formatDate } from "@/lib/dates";
import { paiseToDecimalString } from "@/lib/money";

/** Vendor statement: bills and payments (Excel). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "BAD_ID" }, { status: 400 });
  const ctx = await getAppContext();
  const { data: v } = await ctx.supabase.from("vendors").select("display_name").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!v) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const [{ data: bills }, { data: pays }] = await Promise.all([
    ctx.supabase.from("bills").select("invoice_number, invoice_date, due_date, amount_paise, paid_paise, status, paid_reference").eq("vendor_id", id).is("deleted_at", null).order("invoice_date"),
    ctx.supabase.from("run_payments").select("amount_paise, status, utr, resolved_at, method").eq("vendor_id", id).eq("workspace_id", ctx.workspace.id).order("created_at"),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((bills ?? []).map((b) => ({ "Invoice no": b.invoice_number, "Invoice date": formatDate(b.invoice_date), "Due date": formatDate(b.due_date), "Amount (INR)": Number(paiseToDecimalString(b.amount_paise)), "Paid (INR)": Number(paiseToDecimalString(b.paid_paise)), Status: b.status, Reference: b.paid_reference ?? "" }))), "Bills");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((pays ?? []).map((p) => ({ Date: formatDate((p.resolved_at ?? "").slice(0, 10) || null), "Amount (INR)": Number(paiseToDecimalString(p.amount_paise)), Status: p.status, UTR: p.utr ?? "", Method: p.method }))), "Payments");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safe = v.display_name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="statement-${safe}.xlsx"`, "Cache-Control": "no-store" },
  });
}
