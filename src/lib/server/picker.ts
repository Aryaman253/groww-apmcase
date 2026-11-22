import "server-only";
import type { AppContext } from "./context";
import type { PickerVendor } from "@/components/bills/vendor-picker";

export async function pickerVendors(ctx: AppContext): Promise<PickerVendor[]> {
  const { data } = await ctx.supabase
    .from("vendors")
    .select("id, display_name, gstin, credit_days")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .order("display_name");
  return (data ?? []).map((v) => ({ id: v.id, name: v.display_name, gstin: v.gstin, creditDays: v.credit_days }));
}
