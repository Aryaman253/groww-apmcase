import { computeDueDate, parseIndianDate, type IsoDate } from "../dates";
import { parseAmountToPaise } from "../money";
import { findDuplicateBills, type DuplicateReason } from "../payments/duplicates";
import { matchVendor, normalizeVendorName, type MatchableVendor, type VendorMatchResult } from "../payments/match-vendor";
import type { Bill } from "../payments/types";
import { isValidGstin, normalizeGstin } from "../validation";
import type { ColumnMapping } from "./mapping";

export const IMPORT_ERROR_CODES = [
  "MISSING_VENDOR",
  "MISSING_INVOICE_NUMBER",
  "MISSING_AMOUNT",
  "INVALID_AMOUNT", // not a number
  "NON_POSITIVE_AMOUNT", // ≤ 0 (credit notes, advances)
  "INVALID_DATE", // invoice date present but unreadable
  "DUPLICATE_IN_FILE", // same vendor + invoice number earlier in this file
  "ALREADY_IMPORTED", // same vendor + invoice number already exists
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const IMPORT_WARNING_CODES = [
  "NEW_VENDOR", // no vendor match and no suggestions
  "VENDOR_SUGGESTIONS", // no match; fuzzy suggestions available — user must pick
  "INVALID_GSTIN",
  "MISSING_INVOICE_DATE",
  "INVALID_DUE_DATE", // due date unreadable — computed from credit days instead
  "DUE_DATE_COMPUTED", // no printed due date; invoice date + credit days
  "DUE_BEFORE_INVOICE",
  "POSSIBLE_DUPLICATE_IN_FILE", // same vendor + amount + date earlier in this file
  "POSSIBLE_DUPLICATE_EXISTING", // same vendor + amount + date already exists
] as const;
export type ImportWarningCode = (typeof IMPORT_WARNING_CODES)[number];

export type ImportVendor = MatchableVendor & { creditDays?: number | null };

export type DuplicateOf =
  | { kind: "file"; index: number; reason: DuplicateReason }
  | { kind: "existing"; billId: string; reason: DuplicateReason };

export interface ImportPreviewRow<V extends ImportVendor = ImportVendor> {
  /** Index into the `rows` passed in. */
  index: number;
  vendorName: string;
  gstin: string | null;
  invoiceNumber: string;
  invoiceDate: IsoDate | null;
  dueDate: IsoDate | null;
  amountPaise: number | null;
  /** Credit days used when the due date was computed. */
  creditDaysUsed: number | null;
  errors: ImportErrorCode[];
  warnings: ImportWarningCode[];
  vendorMatch: VendorMatchResult<V>;
  duplicateOf: DuplicateOf | null;
  /** Total/subtotal rows (e.g. Tally "Grand Total"); not importable, hide in UI. */
  skipped: boolean;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

/**
 * Amount cell → paise. Numbers as-is; text like "1,23,456.50", "₹ 12,000", "(500.00)",
 * "12,345.00 Cr" / "Dr" (Tally balance suffixes — stripped, NOT read as crore).
 */
export function parseImportAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim();
  let neg = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    neg = true;
    s = paren[1];
  }
  s = s.replace(/\s*\b(cr|dr)\.?$/i, "").trim();
  if (!s) return null;
  const p = parseAmountToPaise(s);
  if (p === null) return null;
  return neg ? -Math.abs(p) : p;
}

const TOTAL_ROW_RE = /^(grand\s*total|sub\s*-?\s*total|total)\b/i;

/**
 * Maps raw spreadsheet rows to bill previews with row-level validation, vendor
 * matching (GSTIN → exact name → suggestions; fuzzy never auto-assigned), due-date
 * computation and de-duplication within the file and against existing bills.
 */
export function mapRows<V extends ImportVendor>(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
  ctx: { vendors: V[]; existingBills: Bill[]; defaultCreditDays: number },
): ImportPreviewRow<V>[] {
  const get = (r: Record<string, unknown>, k: keyof ColumnMapping) => (mapping[k] ? r[mapping[k]!] : undefined);
  const seen: { id: string; vendorId: string; invoiceNumber: string; invoiceDate: string | null; amountPaise: number }[] = [];

  return rows.map((r, index) => {
    const errors: ImportErrorCode[] = [];
    const warnings: ImportWarningCode[] = [];
    const vendorName = text(get(r, "vendor"));
    const invoiceNumber = text(get(r, "invoiceNumber"));
    const rawGstin = text(get(r, "gstin"));
    const gstin = rawGstin ? normalizeGstin(rawGstin) : null;
    const rawAmount = get(r, "amount");
    const rawInvDate = get(r, "invoiceDate");
    const rawDueDate = get(r, "dueDate");

    const skipped = TOTAL_ROW_RE.test(vendorName) && !invoiceNumber;
    const vendorMatch = skipped
      ? { match: null, kind: null, suggestions: [] }
      : matchVendor({ gstin: gstin && isValidGstin(gstin) ? gstin : null, name: vendorName }, ctx.vendors);

    if (!vendorName) errors.push("MISSING_VENDOR");
    if (!invoiceNumber) errors.push("MISSING_INVOICE_NUMBER");

    let amountPaise: number | null = null;
    if (rawAmount === null || rawAmount === undefined || text(rawAmount) === "") errors.push("MISSING_AMOUNT");
    else {
      amountPaise = parseImportAmount(rawAmount);
      if (amountPaise === null) errors.push("INVALID_AMOUNT");
      else if (amountPaise <= 0) errors.push("NON_POSITIVE_AMOUNT");
    }

    let invoiceDate: IsoDate | null = null;
    if (text(rawInvDate)) {
      invoiceDate = parseIndianDate(rawInvDate);
      if (!invoiceDate) errors.push("INVALID_DATE");
    } else warnings.push("MISSING_INVOICE_DATE");

    let printedDue: IsoDate | null = null;
    if (text(rawDueDate)) {
      printedDue = parseIndianDate(rawDueDate);
      if (!printedDue) warnings.push("INVALID_DUE_DATE");
    }
    const vendor = vendorMatch.match;
    const creditDays = vendor?.creditDays ?? ctx.defaultCreditDays;
    const dueDate = computeDueDate({ printedDueDate: printedDue, invoiceDate, creditDays });
    const creditDaysUsed = !printedDue && invoiceDate ? creditDays : null;
    if (creditDaysUsed !== null) warnings.push("DUE_DATE_COMPUTED");
    if (dueDate && invoiceDate && dueDate < invoiceDate) warnings.push("DUE_BEFORE_INVOICE");

    if (gstin && !isValidGstin(gstin)) warnings.push("INVALID_GSTIN");
    if (!skipped && vendorName && !vendor) warnings.push(vendorMatch.suggestions.length ? "VENDOR_SUGGESTIONS" : "NEW_VENDOR");

    // De-duplication: existing bills first (only possible for a matched vendor), then earlier rows.
    let duplicateOf: DuplicateOf | null = null;
    if (!skipped && invoiceNumber && amountPaise !== null) {
      const cand = { vendorId: vendor?.id ?? "", invoiceNumber, invoiceDate, amountPaise };
      if (vendor) {
        const hits = findDuplicateBills(cand, ctx.existingBills);
        const hit = hits.find((h) => h.reason === "same_invoice_number") ?? hits[0];
        if (hit) {
          duplicateOf = { kind: "existing", billId: hit.bill.id, reason: hit.reason };
          if (hit.reason === "same_invoice_number") errors.push("ALREADY_IMPORTED");
          else warnings.push("POSSIBLE_DUPLICATE_EXISTING");
        }
      }
      const key = vendor ? `id:${vendor.id}` : `name:${normalizeVendorName(vendorName)}`;
      const fileCand = { ...cand, vendorId: key };
      if (!duplicateOf) {
        const hits = findDuplicateBills(fileCand, seen);
        const hit = hits.find((h) => h.reason === "same_invoice_number") ?? hits[0];
        if (hit) {
          duplicateOf = { kind: "file", index: Number(hit.bill.id), reason: hit.reason };
          if (hit.reason === "same_invoice_number") errors.push("DUPLICATE_IN_FILE");
          else warnings.push("POSSIBLE_DUPLICATE_IN_FILE");
        }
      }
      if (!duplicateOf || duplicateOf.reason !== "same_invoice_number") seen.push({ ...fileCand, id: String(index) });
    }

    return {
      index,
      vendorName,
      gstin,
      invoiceNumber,
      invoiceDate,
      dueDate,
      amountPaise,
      creditDaysUsed,
      errors: skipped ? [] : errors,
      warnings: skipped ? [] : warnings,
      vendorMatch,
      duplicateOf,
      skipped,
    };
  });
}
