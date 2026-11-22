import { addDays, todayIst } from "../dates";
import { isValidAccountNumber, isValidIfsc, isValidUpi, normalizeAccount } from "../validation";
import { normalizeInvoiceNumber } from "./duplicates";
import type { BankDetailsVersion, IsoDate, IsoTimestamp, PaymentMethod, PaymentVendor, RunPaymentStatus } from "./types";

export interface HoldOptions {
  /** Default true. */
  enabled?: boolean;
  /** Default 24. */
  hours?: number;
  /** Also hold a vendor's very first approval (default false: only changes are held). */
  includeFirstApproval?: boolean;
}

export type PayableBlockReason =
  | "VENDOR_NOT_VERIFIED"
  | "MISSING_BANK_DETAILS"
  | "BANK_NOT_APPROVED"
  | "CHANGED_AWAITING_APPROVAL"
  | "HOLD_PERIOD";

export interface PayableResult {
  payable: boolean;
  /** All reasons; empty when payable. */
  reasons: PayableBlockReason[];
  /** The approved version that would be paid (even when blocked by status/hold). */
  approved: BankDetailsVersion | null;
  /** End of the hold window when reasons include HOLD_PERIOD. */
  holdUntil: IsoTimestamp | null;
}

function hasBank(v: BankDetailsVersion | null | undefined): boolean {
  if (!v?.ifsc || !isValidIfsc(v.ifsc)) return false;
  return v.accountNumber ? isValidAccountNumber(v.accountNumber) : /^\d{4}$/.test(v.accountLast4 ?? "");
}
const wasApproved = (v: BankDetailsVersion) => v.status === "approved" || v.status === "superseded";
function hasUpi(v: BankDetailsVersion | null | undefined): boolean {
  return !!v?.upiId && isValidUpi(v.upiId);
}

/** Versions newest first, rejected change requests dropped (a rejected change never replaces approved details). */
function effectiveVersions(vendor: PaymentVendor): BankDetailsVersion[] {
  return [...(vendor.bankDetails ?? [])].filter((v) => v.status !== "rejected").sort((a, b) => b.version - a.version);
}

/**
 * The bank details currently in force: the latest non-rejected version, only if
 * it is approved. A pending change means there are NO usable details (blocked).
 */
export function approvedBankDetails(vendor: PaymentVendor): BankDetailsVersion | null {
  const latest = effectiveVersions(vendor)[0];
  return latest?.status === "approved" ? latest : null;
}

/**
 * Changed-bank-details blocking rule. A vendor is payable only when:
 * 1. vendor.status === "verified" (DB "new"/"changed" are blocked);
 * 2. the latest bank-details version (ignoring rejected change requests) is approved —
 *    any pending change blocks payment entirely (we never fall back to the old details);
 * 3. the approved version has a usable account+IFSC or UPI ID;
 * 4. the hold window has passed: a changed version approved less than `hold.hours`
 *    (default 24h) ago is blocked (first approvals too when includeFirstApproval).
 *    A version without approvedAt is treated as outside the window.
 */
export function isVendorPayable(vendor: PaymentVendor, opts: { now?: Date; hold?: HoldOptions } = {}): PayableResult {
  const now = opts.now ?? new Date();
  const hold = { enabled: true, hours: 24, includeFirstApproval: false, ...opts.hold };
  const reasons: PayableBlockReason[] = [];
  if (vendor.status !== "verified") reasons.push("VENDOR_NOT_VERIFIED");

  const versions = effectiveVersions(vendor);
  const latest = versions[0];
  let approved: BankDetailsVersion | null = null;
  let holdUntil: IsoTimestamp | null = null;

  if (!latest) reasons.push("MISSING_BANK_DETAILS");
  else if (latest.status !== "approved") {
    reasons.push(versions.slice(1).some(wasApproved) ? "CHANGED_AWAITING_APPROVAL" : "BANK_NOT_APPROVED");
  } else {
    approved = latest;
    if (!hasBank(latest) && !hasUpi(latest)) reasons.push("MISSING_BANK_DETAILS");
    const isChange = versions.slice(1).some(wasApproved);
    if (hold.enabled && latest.approvedAt && (isChange || hold.includeFirstApproval)) {
      const until = new Date(new Date(latest.approvedAt).getTime() + hold.hours * 3600_000);
      if (!Number.isNaN(until.getTime()) && now.getTime() < until.getTime()) {
        reasons.push("HOLD_PERIOD");
        holdUntil = until.toISOString();
      }
    }
  }
  return { payable: reasons.length === 0, reasons, approved, holdUntil };
}

/**
 * Suggested method: "direct" when direct pay is available and the vendor has
 * approved bank details or UPI; else "bank_file" with approved bank details;
 * else "upi" with only an approved UPI ID; else null.
 */
export function suggestMethod(vendor: PaymentVendor, opts: { directPayAvailable: boolean }): PaymentMethod | null {
  const a = approvedBankDetails(vendor);
  const bank = hasBank(a);
  const upi = hasUpi(a);
  if (opts.directPayAvailable && (bank || upi)) return "direct";
  if (bank) return "bank_file";
  if (upi) return "upi";
  return null;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export const PAYMENT_WARNING_CODES = [
  "VENDOR_NOT_VERIFIED", // blocking
  "MISSING_BANK_DETAILS", // excluded from the run
  "BANK_NOT_APPROVED", // blocking (first details still pending)
  "CHANGED_AWAITING_APPROVAL", // blocking
  "HOLD_PERIOD", // blocking
  "NEW_PAYEE",
  "AMOUNT_UNUSUAL",
  "POSSIBLE_DUPLICATE",
] as const;
export type PaymentWarningCode = (typeof PAYMENT_WARNING_CODES)[number];

export interface PaymentHistoryEntry {
  vendorId: string;
  amountPaise: number;
  /** Date (or timestamp) the payment was made/sent. */
  date: IsoDate | IsoTimestamp;
  /** Only paid/sent/processing (or undefined) count as made payments. */
  status?: RunPaymentStatus;
  invoiceNumbers?: string[];
  billIds?: string[];
  accountNumber?: string | null;
}

export interface PaymentCandidate {
  amountPaise: number;
  invoiceNumbers?: string[];
  billIds?: string[];
}

export interface PaymentWarningsResult {
  /** Cannot be paid now (still shown in the run). */
  blocking: boolean;
  /** Should not be in the run at all (no details to pay to). */
  excluded: boolean;
  warnings: PaymentWarningCode[];
}

const COUNTED: ReadonlySet<RunPaymentStatus> = new Set(["paid", "sent", "processing"]);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Warnings for one proposed payment.
 * - AMOUNT_UNUSUAL: amount > 2× median of the vendor's last `usualLookback` (10) payments
 *   AND more than ₹10,000 above that median. No history → no warning.
 * - POSSIBLE_DUPLICATE: same vendor + same amount within the last 7 days, or any of the
 *   invoices/bills already paid.
 * - NEW_PAYEE: vendor never paid, or the approved account was never paid before.
 */
export function paymentWarnings(
  vendor: PaymentVendor,
  payment: PaymentCandidate,
  history: PaymentHistoryEntry[],
  opts: { now?: Date; hold?: HoldOptions; usualLookback?: number; duplicateWindowDays?: number } = {},
): PaymentWarningsResult {
  const now = opts.now ?? new Date();
  const warnings: PaymentWarningCode[] = [];
  const p = isVendorPayable(vendor, { now, hold: opts.hold });
  for (const r of p.reasons) warnings.push(r);
  const excluded = p.reasons.includes("MISSING_BANK_DETAILS");
  const blocking = p.reasons.some((r) => r !== "MISSING_BANK_DETAILS");

  const past = history
    .filter((h) => h.vendorId === vendor.id && (h.status === undefined || COUNTED.has(h.status)))
    .sort((a, b) => b.date.localeCompare(a.date));

  const acct = p.approved?.accountNumber ? normalizeAccount(p.approved.accountNumber) : null;
  const withAcct = past.filter((h) => h.accountNumber);
  if (!past.length || (acct && withAcct.length && !withAcct.some((h) => normalizeAccount(h.accountNumber!) === acct))) {
    warnings.push("NEW_PAYEE");
  }

  if (past.length) {
    const recent = past.slice(0, opts.usualLookback ?? 10).map((h) => h.amountPaise);
    const med = median(recent);
    if (payment.amountPaise > 2 * med && payment.amountPaise - med > 10_000_00) warnings.push("AMOUNT_UNUSUAL");
  }

  const since = addDays(todayIst(now), -(opts.duplicateWindowDays ?? 7));
  const invs = new Set((payment.invoiceNumbers ?? []).map(normalizeInvoiceNumber).filter(Boolean));
  const bills = new Set(payment.billIds ?? []);
  const dup = past.some(
    (h) =>
      (h.amountPaise === payment.amountPaise && h.date.slice(0, 10) >= since) ||
      (h.invoiceNumbers ?? []).some((n) => invs.has(normalizeInvoiceNumber(n))) ||
      (h.billIds ?? []).some((b) => bills.has(b)),
  );
  if (dup) warnings.push("POSSIBLE_DUPLICATE");

  return { blocking, excluded, warnings };
}
