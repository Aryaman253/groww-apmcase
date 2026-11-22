/**
 * Domain shapes used by the payments and import libs. These are structural:
 * DB rows only need to be mapped to these field names.
 */

export type IsoDate = string; // "YYYY-MM-DD"
export type IsoTimestamp = string; // "2026-11-22T10:00:00Z"

/** Mirrors vendors.status: new = never approved, verified = latest details approved, changed = pending change. */
export type VendorStatus = "new" | "verified" | "changed";

/** One version of a vendor's bank details. Every change creates a new version that must be approved. */
export interface BankDetailsVersion {
  version: number;
  /** superseded = an earlier approved version replaced by a newer approval. */
  status: "approved" | "pending" | "rejected" | "superseded";
  /** Plain account number when available (server side, decrypted). */
  accountNumber?: string | null;
  /** Enough for payability checks when the full number is not loaded. */
  accountLast4?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
  /** When the version was approved (starts the hold window). */
  approvedAt?: IsoTimestamp | null;
}

export interface PaymentVendor {
  id: string;
  name: string;
  /** Must be "verified" to be payable. */
  status: VendorStatus | (string & {});
  gstin?: string | null;
  creditDays?: number | null;
  /** All versions, any order. */
  bankDetails?: BankDetailsVersion[] | null;
}

export interface Bill {
  id: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate?: IsoDate | null;
  dueDate?: IsoDate | null;
  /** Outstanding amount in paise. */
  amountPaise: number;
}

/**
 * Status of a payment within a run:
 * - pending:    in the run, nothing sent yet
 * - sent:       bank file downloaded/uploaded, or direct-pay request submitted
 * - processing: bank/provider acknowledged, awaiting final status
 * - paid:       money credited (terminal)
 * - failed:     rejected/failed by the bank (terminal)
 * - reversed:   was paid, later returned by the beneficiary bank (terminal; counts as failed)
 * - skipped:    removed from the run / excluded; ignored for run status
 */
export const RUN_PAYMENT_STATUSES = ["pending", "sent", "processing", "paid", "failed", "reversed", "skipped"] as const;
export type RunPaymentStatus = (typeof RUN_PAYMENT_STATUSES)[number];

/** Mirrors payment_runs.status. "cancelled" is a user action and never derived. */
export type RunStatus = "draft" | "confirmed" | "in_progress" | "completed" | "partly_failed" | "cancelled";

export type PaymentMethod = "direct" | "bank_file" | "upi";
