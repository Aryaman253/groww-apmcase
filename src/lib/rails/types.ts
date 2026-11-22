/**
 * PaymentRail: how a run payment leaves the business. Four implementations:
 *  - RazorpayX Payouts (test mode)   — kind "payout"
 *  - Cashfree Payouts (sandbox)       — kind "payout"
 *  - Bank bulk file                   — kind "handoff" (owner uploads the file in net banking)
 *  - UPI handoff                      — kind "handoff" (owner pays in their UPI app)
 * plus a "simulated" payout rail used for demos/tests when no provider keys exist.
 * TArrow never holds money: payouts run in the business's own provider account.
 */
export type RailId = "razorpayx" | "cashfree" | "simulated" | "bank_file" | "upi";

export interface PaymentRail {
  id: RailId;
  kind: "payout" | "handoff";
  /** Test/sandbox only in this build. */
  testMode: boolean;
}

export type PayoutMode = "IMPS" | "NEFT" | "RTGS" | "UPI";
export type PayoutStatus = "processing" | "processed" | "failed" | "reversed";

export interface Beneficiary {
  /** Stable per vendor bank-details version. */
  ref: string;
  name: string;
  accountNumber?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PayoutRequest {
  /** Deterministic: same run payment → same key → never paid twice. */
  idempotencyKey: string;
  /** run_payment.id — echoed back by webhooks. */
  referenceId: string;
  amountPaise: number;
  mode: PayoutMode;
  beneficiary: Beneficiary;
  /** Cached provider ids for this beneficiary, if known. */
  cached?: ProviderRefs | null;
  narration: string;
}

export interface ProviderRefs {
  contactId?: string;
  fundAccountId?: string;
  beneficiaryId?: string;
}

export interface PayoutResult {
  providerPayoutId: string;
  status: PayoutStatus;
  utr?: string | null;
  failureReason?: string | null;
  providerStatus?: string;
  refs?: ProviderRefs;
}

export interface VerifyResult {
  status: "valid" | "invalid" | "unavailable";
  nameAtBank?: string | null;
  refs?: ProviderRefs;
  detail?: string;
}

export interface WebhookEvent {
  eventId: string;
  referenceId: string | null;
  providerPayoutId: string | null;
  status: PayoutStatus | null;
  utr: string | null;
  failureReason: string | null;
}

export interface PayoutRail extends PaymentRail {
  kind: "payout";
  /** Available balance in paise, or null if the provider can't report it. */
  getBalance(): Promise<number | null>;
  verifyAccount(b: Beneficiary, cached?: ProviderRefs | null): Promise<VerifyResult>;
  createPayout(req: PayoutRequest): Promise<PayoutResult>;
  /** Fallback polling. Looks up by provider id, or by our reference when the id is unknown. */
  getPayout(q: { providerPayoutId?: string | null; referenceId: string; createdAt?: string }): Promise<PayoutResult | null>;
  verifyWebhook(rawBody: string, headers: Headers, secret: string): boolean;
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
}

export class RailError extends Error {
  constructor(
    public code: "INSUFFICIENT_BALANCE" | "AUTH" | "VALIDATION" | "PROVIDER" | "NETWORK",
    message: string,
  ) {
    super(message);
  }
}
