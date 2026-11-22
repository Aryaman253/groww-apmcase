import { createHmac, timingSafeEqual } from "node:crypto";
import { httpJson } from "./http";
import { RailError, type PayoutRail, type PayoutResult, type PayoutStatus, type WebhookEvent } from "./types";

/**
 * Cashfree Payouts v2 — SANDBOX only. Covered by unit tests against recorded responses;
 * not exercised live in this build (no sandbox credentials were provided).
 */
const BASE = "https://sandbox.cashfree.com/payout";

type CfTransfer = { cf_transfer_id?: string; transfer_id?: string; status?: string; status_code?: string; status_description?: string; transfer_utr?: string | null };

function mapStatus(s?: string): PayoutStatus {
  const v = (s ?? "").toUpperCase();
  if (v === "SUCCESS" || v === "COMPLETED") return "processed";
  if (v === "REVERSED") return "reversed";
  if (["FAILED", "REJECTED"].includes(v)) return "failed";
  return "processing";
}
function toResult(t: CfTransfer): PayoutResult {
  const status = mapStatus(t.status);
  return {
    providerPayoutId: t.cf_transfer_id ?? t.transfer_id ?? "",
    status,
    utr: t.transfer_utr ?? null,
    failureReason: status === "failed" || status === "reversed" ? (t.status_description ?? t.status_code ?? "Failed") : null,
    providerStatus: t.status,
  };
}

export function cashfree(creds: { clientId: string; clientSecret: string }): PayoutRail {
  const headers = { "x-client-id": creds.clientId, "x-client-secret": creds.clientSecret, "x-api-version": "2024-01-01", "Content-Type": "application/json" };
  return {
    id: "cashfree",
    kind: "payout",
    testMode: true,
    async getBalance() {
      return null; // v2 has no simple balance endpoint; the transfer fails clearly if funds are short
    },
    async verifyAccount() {
      return { status: "unavailable", detail: "Bank account verification is a separate Cashfree product" };
    },
    async createPayout(req) {
      const beneficiaryId = (req.cached?.beneficiaryId ?? `tarrow_${req.beneficiary.ref}`).replace(/[^A-Za-z0-9_|-]/g, "").slice(0, 50);
      if (!req.cached?.beneficiaryId) {
        const { status, body } = await httpJson<{ message?: string; code?: string }>(`${BASE}/beneficiary`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            beneficiary_id: beneficiaryId,
            beneficiary_name: req.beneficiary.name.slice(0, 100),
            beneficiary_instrument_details: req.beneficiary.accountNumber
              ? { bank_account_number: req.beneficiary.accountNumber, bank_ifsc: req.beneficiary.ifsc }
              : { vpa: req.beneficiary.upiId },
            beneficiary_contact_details: { beneficiary_email: req.beneficiary.email || undefined, beneficiary_phone: req.beneficiary.phone || undefined },
          }),
        });
        if (status >= 300 && body.code !== "beneficiary_id_already_exists") throw new RailError("VALIDATION", body.message ?? "Could not add beneficiary");
      }
      const { status, body } = await httpJson<CfTransfer & { message?: string; code?: string }>(`${BASE}/transfers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          transfer_id: req.referenceId, // unique per run payment → idempotent at Cashfree
          transfer_amount: req.amountPaise / 100,
          transfer_currency: "INR",
          transfer_mode: req.mode === "UPI" ? "upi" : req.mode.toLowerCase(),
          beneficiary_details: { beneficiary_id: beneficiaryId },
          transfer_remarks: req.narration.replace(/[^A-Za-z0-9 ]/g, " ").slice(0, 70),
        }),
      });
      if (status === 409 || body.code === "transfer_id_already_exists") {
        const existing = await this.getPayout({ referenceId: req.referenceId });
        if (existing) return { ...existing, refs: { beneficiaryId } };
      }
      if (status >= 300) {
        const msg = body.message ?? "Transfer failed";
        if (/balance/i.test(msg)) throw new RailError("INSUFFICIENT_BALANCE", msg);
        throw new RailError("PROVIDER", msg);
      }
      return { ...toResult(body), refs: { beneficiaryId } };
    },
    async getPayout(q) {
      const { status, body } = await httpJson<CfTransfer>(`${BASE}/transfers?transfer_id=${encodeURIComponent(q.referenceId)}`, { headers });
      return status < 300 && body ? toResult(body) : null;
    },
    verifyWebhook(rawBody, h, secret) {
      const sig = h.get("x-webhook-signature") ?? "";
      const ts = h.get("x-webhook-timestamp") ?? "";
      const expected = createHmac("sha256", secret).update(ts + rawBody).digest("base64");
      return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    },
    parseWebhook(rawBody, h): WebhookEvent | null {
      const j = JSON.parse(rawBody) as { type?: string; data?: { transfer?: CfTransfer } };
      const t = j.data?.transfer;
      if (!t) return null;
      const r = toResult(t);
      return {
        eventId: `${h.get("x-webhook-timestamp") ?? ""}:${t.cf_transfer_id ?? t.transfer_id}:${t.status}`,
        referenceId: t.transfer_id ?? null,
        providerPayoutId: t.cf_transfer_id ?? null,
        status: r.status,
        utr: r.utr ?? null,
        failureReason: r.failureReason ?? null,
      };
    },
  };
}
