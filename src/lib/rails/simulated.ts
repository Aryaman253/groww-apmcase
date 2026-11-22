import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PayoutRail, PayoutResult, WebhookEvent } from "./types";

/**
 * Simulated test rail (no real provider, no money). Used by demo workspaces when the
 * app has no provider test keys, and by end-to-end tests.
 * - Payouts settle ~4s after creation when polled, or immediately via a signed webhook.
 * - An amount whose paise part is .13 fails ("Simulated failure"), to exercise failure paths.
 * - The account holder name check returns the vendor name unless it contains "mismatch".
 */
export const SIM_SETTLE_MS = 4000;

function utrFor(ref: string) {
  return "SIMUTR" + createHash("sha256").update(ref).digest("hex").slice(0, 10).toUpperCase();
}

export function simulated(): PayoutRail {
  return {
    id: "simulated",
    kind: "payout",
    testMode: true,
    async getBalance() {
      return 50_00_00_000_00; // ₹50 crore of fake money
    },
    async verifyAccount(b) {
      return { status: "valid", nameAtBank: /mismatch/i.test(b.name) ? "SOMEONE ELSE TRADERS" : b.name.toUpperCase() };
    },
    async createPayout(req): Promise<PayoutResult> {
      return { providerPayoutId: `sim_${req.idempotencyKey}`, status: "processing", providerStatus: req.amountPaise % 100 === 13 ? "will_fail" : "processing" };
    },
    async getPayout(q) {
      const age = q.createdAt ? Date.now() - new Date(q.createdAt).getTime() : SIM_SETTLE_MS;
      const id = q.providerPayoutId ?? `sim_tarrow-${q.referenceId}`;
      if (age < SIM_SETTLE_MS) return { providerPayoutId: id, status: "processing" };
      return { providerPayoutId: id, status: "processed", utr: utrFor(q.referenceId) };
    },
    verifyWebhook(rawBody, h, secret) {
      const sig = h.get("x-simulated-signature") ?? "";
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    },
    parseWebhook(rawBody): WebhookEvent | null {
      const j = JSON.parse(rawBody) as { id?: string; reference_id?: string; status?: "processed" | "failed" | "reversed"; utr?: string; reason?: string };
      if (!j.reference_id || !j.status) return null;
      return {
        eventId: j.id ?? `${j.reference_id}:${j.status}`,
        referenceId: j.reference_id,
        providerPayoutId: `sim_tarrow-${j.reference_id}`,
        status: j.status,
        utr: j.status === "processed" ? (j.utr ?? utrFor(j.reference_id)) : null,
        failureReason: j.status === "processed" ? null : (j.reason ?? "Simulated failure"),
      };
    },
  };
}

export { utrFor as simulatedUtr };
