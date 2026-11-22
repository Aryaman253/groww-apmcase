import { createHmac, timingSafeEqual } from "node:crypto";
import { httpJson } from "./http";
import { RailError, type Beneficiary, type PayoutRail, type PayoutRequest, type PayoutResult, type PayoutStatus, type ProviderRefs, type VerifyResult, type WebhookEvent } from "./types";

const BASE = "https://api.razorpay.com/v1";

type RzpPayout = { id: string; status: string; utr?: string | null; reference_id?: string | null; status_details?: { description?: string | null; reason?: string | null } | null; failure_reason?: string | null };
type RzpError = { error?: { code?: string; description?: string; reason?: string } };

function mapStatus(s: string): PayoutStatus {
  if (s === "processed") return "processed";
  if (s === "reversed") return "reversed";
  if (["failed", "rejected", "cancelled"].includes(s)) return "failed";
  return "processing"; // queued, pending, scheduled, processing
}

function toResult(p: RzpPayout, refs?: ProviderRefs): PayoutResult {
  const status = mapStatus(p.status);
  return {
    providerPayoutId: p.id,
    status,
    utr: p.utr ?? null,
    failureReason: status === "failed" || status === "reversed" ? (p.status_details?.description ?? p.failure_reason ?? p.status) : null,
    providerStatus: p.status,
    refs,
  };
}

/** RazorpayX Payouts — TEST MODE keys only (rzp_test_…). */
export function razorpayx(creds: { keyId: string; keySecret: string; accountNumber: string }): PayoutRail {
  const auth = "Basic " + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const headers = { Authorization: auth, "Content-Type": "application/json" };

  async function ensureFundAccount(b: Beneficiary, cached?: ProviderRefs | null): Promise<ProviderRefs> {
    if (cached?.fundAccountId) return cached;
    let contactId = cached?.contactId;
    if (!contactId) {
      const { status, body } = await httpJson<{ id: string } & RzpError>(`${BASE}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: b.name.slice(0, 50), email: b.email || undefined, contact: b.phone || undefined, type: "vendor", reference_id: b.ref.slice(0, 40) }),
      });
      if (status >= 300 || !body.id) throw new RailError("VALIDATION", body.error?.description ?? "Could not create contact");
      contactId = body.id;
    }
    const fa = b.accountNumber
      ? { contact_id: contactId, account_type: "bank_account", bank_account: { name: b.name.slice(0, 120), ifsc: b.ifsc, account_number: b.accountNumber } }
      : { contact_id: contactId, account_type: "vpa", vpa: { address: b.upiId } };
    const { status, body } = await httpJson<{ id: string } & RzpError>(`${BASE}/fund_accounts`, { method: "POST", headers, body: JSON.stringify(fa) });
    if (status >= 300 || !body.id) throw new RailError("VALIDATION", body.error?.description ?? "Could not create fund account");
    return { contactId, fundAccountId: body.id };
  }

  return {
    id: "razorpayx",
    kind: "payout",
    testMode: true,

    async getBalance() {
      const { status, body } = await httpJson<{ items?: { account_number: string; available_amount?: number; amount?: number }[] }>(`${BASE}/banking_balances`, { headers });
      if (status >= 300) return null;
      const acct = body.items?.find((i) => i.account_number === creds.accountNumber) ?? body.items?.[0];
      return acct ? (acct.available_amount ?? acct.amount ?? null) : null;
    },

    async verifyAccount(b, cached): Promise<VerifyResult> {
      if (!b.accountNumber) return { status: "unavailable", detail: "UPI-only" };
      try {
        const refs = await ensureFundAccount(b, cached);
        const { status, body } = await httpJson<{ id: string; status: string; results?: { account_status?: string; registered_name?: string } } & RzpError>(
          `${BASE}/fund_accounts/validations`,
          { method: "POST", headers, body: JSON.stringify({ account_number: creds.accountNumber, fund_account: { id: refs.fundAccountId }, amount: 100, currency: "INR", notes: { purpose: "TArrow name check" } }) },
        );
        if (status >= 300) return { status: "unavailable", refs, detail: body.error?.description ?? "Validation unavailable" };
        let v = body;
        for (let i = 0; i < 6 && v.status !== "completed" && v.status !== "failed"; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          v = (await httpJson<typeof body>(`${BASE}/fund_accounts/validations/${body.id}`, { headers })).body;
        }
        if (v.status !== "completed") return { status: "unavailable", refs, detail: `Validation ${v.status}` };
        return {
          status: v.results?.account_status === "active" ? "valid" : "invalid",
          nameAtBank: v.results?.registered_name ?? null,
          refs,
        };
      } catch (e) {
        return { status: "unavailable", detail: e instanceof Error ? e.message : "error" };
      }
    },

    async createPayout(req: PayoutRequest) {
      const refs = await ensureFundAccount(req.beneficiary, req.cached);
      const { status, body } = await httpJson<RzpPayout & RzpError>(`${BASE}/payouts`, {
        method: "POST",
        headers: { ...headers, "X-Payout-Idempotency": req.idempotencyKey },
        body: JSON.stringify({
          account_number: creds.accountNumber,
          fund_account_id: refs.fundAccountId,
          amount: req.amountPaise,
          currency: "INR",
          mode: req.mode,
          purpose: "vendor bill",
          queue_if_low_balance: false,
          reference_id: req.referenceId,
          narration: req.narration.replace(/[^A-Za-z0-9 ]/g, " ").slice(0, 30).trim() || "TArrow payout",
        }),
      });
      if (status >= 300 || !body.id) {
        const msg = body.error?.description ?? "Payout failed";
        if (/balance/i.test(msg)) throw new RailError("INSUFFICIENT_BALANCE", msg);
        throw new RailError("PROVIDER", msg);
      }
      return toResult(body, refs);
    },

    async getPayout(q) {
      if (q.providerPayoutId) {
        const { status, body } = await httpJson<RzpPayout>(`${BASE}/payouts/${q.providerPayoutId}`, { headers });
        return status < 300 ? toResult(body) : null;
      }
      const { status, body } = await httpJson<{ items?: RzpPayout[] }>(
        `${BASE}/payouts?account_number=${creds.accountNumber}&reference_id=${encodeURIComponent(q.referenceId)}`,
        { headers },
      );
      const p = status < 300 ? body.items?.[0] : undefined;
      return p ? toResult(p) : null;
    },

    verifyWebhook(rawBody, h, secret) {
      const sig = h.get("x-razorpay-signature") ?? "";
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    },

    parseWebhook(rawBody, h): WebhookEvent | null {
      const j = JSON.parse(rawBody) as { event?: string; payload?: { payout?: { entity?: RzpPayout } } };
      const p = j.payload?.payout?.entity;
      if (!p || !j.event?.startsWith("payout.")) return null;
      const r = toResult(p);
      return {
        eventId: h.get("x-razorpay-event-id") ?? `${p.id}:${p.status}`,
        referenceId: p.reference_id ?? null,
        providerPayoutId: p.id,
        status: r.status,
        utr: r.utr ?? null,
        failureReason: r.failureReason ?? null,
      };
    },
  };
}
