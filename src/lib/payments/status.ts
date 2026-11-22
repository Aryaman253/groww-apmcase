import type { RunPaymentStatus, RunStatus } from "./types";

const RESOLVED: ReadonlySet<RunPaymentStatus> = new Set(["paid", "failed", "reversed"]);
const FAILED: ReadonlySet<RunPaymentStatus> = new Set(["failed", "reversed"]);

/** paid, failed and reversed are terminal. */
export function isResolvedStatus(s: RunPaymentStatus): boolean {
  return RESOLVED.has(s);
}

/**
 * Derives a run's status from its payments' statuses (see RunPaymentStatus).
 * "skipped" payments are ignored.
 *
 *   draft         — every payment pending and the run not yet confirmed (opts.confirmed false)
 *   confirmed     — every payment pending, run confirmed (or nothing left to pay)
 *   in_progress   — at least one payment sent/processing/resolved, but not all resolved
 *   completed     — all resolved and every one paid
 *   partly_failed — all resolved and ≥1 failed/reversed (including when none were paid:
 *                   the schema has no separate "failed" run state; the UI can tell
 *                   "all failed" from the payment counts)
 *
 * Once any payment has moved past "pending" the run counts as confirmed.
 */
export function runStatusFromPayments(
  statuses: RunPaymentStatus[],
  opts: { confirmed?: boolean } = {},
): Exclude<RunStatus, "cancelled"> {
  const live = statuses.filter((s) => s !== "skipped");
  if (!live.length || live.every((s) => s === "pending")) return opts.confirmed ? "confirmed" : "draft";
  if (!live.every(isResolvedStatus)) return "in_progress";
  return live.some((s) => FAILED.has(s)) ? "partly_failed" : "completed";
}
