import "server-only";
import type { Json } from "@/lib/supabase/database.types";
import type { AppContext } from "./context";

export type ActivityAction =
  | "vendor.created"
  | "vendor.updated"
  | "vendor.deleted"
  | "bank_details.changed"
  | "bank_details.approved"
  | "bank_details.rejected"
  | "bank_details.verified"
  | "vendor_request.created"
  | "vendor_request.submitted"
  | "bill.created"
  | "bill.imported"
  | "bill.updated"
  | "bill.deleted"
  | "bill.held"
  | "bill.unheld"
  | "bill.marked_paid"
  | "run.created"
  | "run.confirmed"
  | "run.file_downloaded"
  | "run.completed"
  | "payout.sent"
  | "payout.updated"
  | "payment.marked_sent"
  | "utr.recorded"
  | "payment.failed"
  | "provider.connected"
  | "provider.disconnected"
  | "debit_account.added"
  | "settings.updated"
  | "demo.reset";

/** Append-only. Never put full account numbers in details — last4 only. */
export async function logActivity(
  ctx: Pick<AppContext, "supabase" | "user">,
  workspaceId: string,
  action: ActivityAction,
  entity?: { type: string; id: string },
  details: Record<string, Json | undefined> = {},
) {
  await ctx.supabase.from("activity_log").insert({
    workspace_id: workspaceId,
    actor_id: ctx.user.id,
    action,
    entity_type: entity?.type ?? null,
    entity_id: entity?.id ?? null,
    details: details as Json,
  });
}
