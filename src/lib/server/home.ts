import "server-only";
import { addDays, todayIst } from "@/lib/dates";
import type { AppContext } from "./context";

export async function getHomeData(ctx: AppContext) {
  const ws = ctx.workspace.id;
  const today = todayIst();
  const horizon = addDays(today, 7);
  const [{ data: dueBills }, { data: vendors }, { data: details }, { data: runs }] = await Promise.all([
    ctx.supabase
      .from("bills")
      .select("id, vendor_id, amount_paise, paid_paise, due_date")
      .eq("workspace_id", ws)
      .is("deleted_at", null)
      .eq("status", "due"),
    ctx.supabase.from("vendors").select("id, status").eq("workspace_id", ws).is("deleted_at", null),
    ctx.supabase.from("vendor_bank_details").select("vendor_id, status").eq("workspace_id", ws).in("status", ["approved", "pending"]),
    ctx.supabase
      .from("payment_runs")
      .select("id, run_number, status, total_paise, payment_count, created_at, confirmed_at")
      .eq("workspace_id", ws)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const bills = dueBills ?? [];
  const inWindow = bills.filter((b) => b.due_date <= horizon);
  const outstanding = (b: { amount_paise: number; paid_paise: number }) => b.amount_paise - b.paid_paise;
  const dueTotal = inWindow.reduce((s, b) => s + outstanding(b), 0);
  const dueVendors = new Set(inWindow.map((b) => b.vendor_id)).size;
  const overdue = bills.filter((b) => b.due_date < today);
  const overdueTotal = overdue.reduce((s, b) => s + outstanding(b), 0);

  const hasDetails = new Set((details ?? []).map((d) => d.vendor_id));
  const pendingFor = new Set((details ?? []).filter((d) => d.status === "pending").map((d) => d.vendor_id));
  const changed = (vendors ?? []).filter((v) => v.status === "changed").length;
  const unreviewed = (vendors ?? []).filter((v) => v.status === "new" && pendingFor.has(v.id)).length;
  const missing = (vendors ?? []).filter((v) => !hasDetails.has(v.id)).length;

  const allRuns = runs ?? [];
  const draft = allRuns.find((r) => r.status === "draft");
  const inProgress = allRuns.filter((r) => r.status === "confirmed" || r.status === "in_progress");
  let missingUtr: { run: (typeof allRuns)[number]; count: number } | null = null;
  if (inProgress.length) {
    const { data: rp } = await ctx.supabase
      .from("run_payments")
      .select("run_id, status")
      .in("run_id", inProgress.map((r) => r.id))
      .in("status", ["pending", "sent", "processing"]);
    const first = inProgress.find((r) => (rp ?? []).some((p) => p.run_id === r.id));
    if (first) missingUtr = { run: first, count: (rp ?? []).filter((p) => p.run_id === first.id).length };
  }

  return {
    horizon,
    dueTotal,
    dueVendors,
    overdueCount: overdue.length,
    overdueTotal,
    changed,
    unreviewed,
    missing,
    draft,
    missingUtr,
    recentRuns: allRuns.slice(0, 3),
  };
}
