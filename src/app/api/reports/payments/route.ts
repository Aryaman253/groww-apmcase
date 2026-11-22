import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAppContext } from "@/lib/server/context";
import { paidPayments } from "@/lib/server/reports";
import { addDays, formatDate, todayIst } from "@/lib/dates";
import { paiseToDecimalString } from "@/lib/money";

export async function GET(req: Request) {
  const ctx = await getAppContext();
  const u = new URL(req.url);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = iso.test(u.searchParams.get("from") ?? "") ? u.searchParams.get("from")! : addDays(todayIst(), -180);
  const to = iso.test(u.searchParams.get("to") ?? "") ? u.searchParams.get("to")! : todayIst();
  const vendor = u.searchParams.get("vendor");
  const pays = await paidPayments(ctx, { from, to, vendorId: vendor && /^[0-9a-f-]{36}$/.test(vendor) ? vendor : undefined });
  const rows = pays.map((p) => ({
    Date: formatDate((p.resolved_at ?? "").slice(0, 10)),
    Vendor: p.vendors?.display_name ?? "",
    "Amount (INR)": Number(paiseToDecimalString(p.amount_paise)),
    UTR: p.utr ?? "",
    Method: p.method,
    Run: p.payment_runs?.run_number ?? "",
  }));
  const months = new Map<string, number>();
  for (const p of pays) months.set((p.resolved_at ?? "").slice(0, 7), (months.get((p.resolved_at ?? "").slice(0, 7)) ?? 0) + p.amount_paise);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Payments");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...months.entries()].sort().map(([m, v]) => ({ Month: m, "Total (INR)": Number(paiseToDecimalString(v)) }))), "By month");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${ctx.workspace.slug}-payments-${from}-${to}.xlsx"`, "Cache-Control": "no-store" },
  });
}
