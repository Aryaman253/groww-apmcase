import type { Bill } from "./types";

/**
 * Normalises an invoice number for comparison: case-, space- and
 * punctuation-insensitive, leading zeros of each digit run dropped before
 * punctuation is removed. "INV-007/24", "inv 7 / 24" and "Inv.0007-024" → "INV724".
 */
export function normalizeInvoiceNumber(v: string | null | undefined): string {
  return (v ?? "")
    .toUpperCase()
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ""))
    .replace(/[^A-Z0-9]/g, "");
}

export type DuplicateReason = "same_invoice_number" | "same_amount_and_date";

export interface DuplicateBillMatch<B> {
  bill: B;
  reason: DuplicateReason;
}

export type DuplicateCandidate = Pick<Bill, "vendorId" | "invoiceNumber" | "amountPaise"> & {
  id?: string;
  invoiceDate?: string | null;
};

/**
 * Finds existing bills that look like the candidate:
 * same vendor + normalised invoice number, or same vendor + amount + invoice date.
 * A bill with the same id as the candidate is ignored.
 */
export function findDuplicateBills<B extends DuplicateCandidate>(candidate: DuplicateCandidate, existing: B[]): DuplicateBillMatch<B>[] {
  const inv = normalizeInvoiceNumber(candidate.invoiceNumber);
  const out: DuplicateBillMatch<B>[] = [];
  for (const b of existing) {
    if (b.vendorId !== candidate.vendorId) continue;
    if (candidate.id && b.id === candidate.id) continue;
    if (inv && normalizeInvoiceNumber(b.invoiceNumber) === inv) out.push({ bill: b, reason: "same_invoice_number" });
    else if (
      candidate.invoiceDate &&
      b.invoiceDate === candidate.invoiceDate &&
      b.amountPaise === candidate.amountPaise
    ) {
      out.push({ bill: b, reason: "same_amount_and_date" });
    }
  }
  return out;
}
