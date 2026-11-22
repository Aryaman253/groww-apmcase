import "server-only";
import type { AppContext } from "./context";

export async function paidPayments(ctx: AppContext, opts: { from: string; to: string; vendorId?: string }) {
  let q = ctx.supabase
    .from("run_payments")
    .select("id, amount_paise, utr, method, resolved_at, vendor_id, vendors(display_name), payment_runs(run_number)")
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "paid")
    .gte("resolved_at", `${opts.from}T00:00:00+05:30`)
    .lte("resolved_at", `${opts.to}T23:59:59+05:30`)
    .order("resolved_at", { ascending: false })
    .limit(5000);
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
  const { data } = await q;
  return data ?? [];
}
