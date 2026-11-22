import "server-only";
import type { AppContext } from "./context";
import type { Row } from "@/lib/supabase";
import { todayIst } from "@/lib/dates";

export type BankDetailSummary = Pick<
  Row<"vendor_bank_details">,
  "id" | "version" | "account_holder_name" | "account_last4" | "ifsc" | "bank_name" | "branch" | "upi_id" | "status" | "source" | "created_at" | "approved_at" | "verification"
>;

export type VendorListItem = Row<"vendors"> & {
  approved: BankDetailSummary | null;
  pending: BankDetailSummary | null;
  dueTotalPaise: number;
  overdueCount: number;
  displayStatus: "verified" | "new" | "changed" | "missing";
};

const BANK_COLS =
  "id, vendor_id, version, account_holder_name, account_last4, ifsc, bank_name, branch, upi_id, status, source, created_at, approved_at, verification";

export function displayStatus(v: Pick<Row<"vendors">, "status">, approved: unknown, pending: unknown): VendorListItem["displayStatus"] {
  if (v.status === "changed") return "changed";
  if (!approved && !pending) return "missing";
  if (v.status === "verified") return "verified";
  return "new";
}

export async function listVendors(ctx: AppContext, opts: { ids?: string[] } = {}): Promise<VendorListItem[]> {
  const ws = ctx.workspace.id;
  let q = ctx.supabase.from("vendors").select("*").eq("workspace_id", ws).is("deleted_at", null).order("display_name");
  if (opts.ids) q = q.in("id", opts.ids);
  const [{ data: vendors }, { data: details }, { data: bills }] = await Promise.all([
    q,
    ctx.supabase.from("vendor_bank_details").select(BANK_COLS).eq("workspace_id", ws).in("status", ["approved", "pending"]),
    ctx.supabase
      .from("bills")
      .select("vendor_id, amount_paise, paid_paise, due_date, status")
      .eq("workspace_id", ws)
      .is("deleted_at", null)
      .in("status", ["due", "scheduled"]),
  ]);
  const today = todayIst();
  return (vendors ?? []).map((v) => {
    const approved = (details ?? []).find((d) => d.vendor_id === v.id && d.status === "approved") ?? null;
    const pending = (details ?? []).find((d) => d.vendor_id === v.id && d.status === "pending") ?? null;
    const vb = (bills ?? []).filter((b) => b.vendor_id === v.id);
    return {
      ...v,
      approved,
      pending,
      dueTotalPaise: vb.reduce((s, b) => s + (b.amount_paise - b.paid_paise), 0),
      overdueCount: vb.filter((b) => b.due_date < today).length,
      displayStatus: displayStatus(v, approved, pending),
    };
  });
}
