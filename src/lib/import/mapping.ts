import { z } from "zod";

export const MAPPING_FIELDS = ["vendor", "invoiceNumber", "invoiceDate", "amount", "dueDate", "gstin"] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];

/** Which spreadsheet header feeds each bill field. */
export const ColumnMappingSchema = z.object({
  vendor: z.string().min(1).optional(),
  invoiceNumber: z.string().min(1).optional(),
  invoiceDate: z.string().min(1).optional(),
  amount: z.string().min(1).optional(),
  dueDate: z.string().min(1).optional(),
  gstin: z.string().min(1).optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

/** A saved, reusable mapping (e.g. "Tally Bills Payable"). */
export const ImportPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mapping: ColumnMappingSchema,
  /** 1-based sheet row of the header, when auto-detection picks the wrong row. */
  headerRowHint: z.number().int().min(1).max(100).optional(),
  sheetName: z.string().min(1).optional(),
});
export type ImportPreset = z.infer<typeof ImportPresetSchema>;

export const REQUIRED_MAPPING_FIELDS: readonly MappingField[] = ["vendor", "invoiceNumber", "amount"];

/** Required fields not yet mapped (vendor, invoiceNumber, amount). */
export function missingRequiredMappings(mapping: ColumnMapping): MappingField[] {
  return REQUIRED_MAPPING_FIELDS.filter((f) => !mapping[f]);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Synonyms per field, most preferred first (normalised: lowercase alphanumerics).
 * For amount, outstanding/pending beats bill amount — we pay what is due.
 */
const SYNONYMS: Record<MappingField, string[]> = {
  gstin: ["gstinuin", "gstin", "gstno", "gstnumber", "gstinno", "partygstin", "gstinofparty", "suppliergstin", "gstregno", "gstregistrationno", "gst"],
  dueDate: ["duedate", "dueon", "paymentduedate", "duedt", "due"],
  invoiceNumber: [
    "invoiceno", "invoicenumber", "invno", "billno", "billnumber", "supplierinvoiceno", "partyinvoiceno", "vchno",
    "vouchernumber", "voucherno", "vchnumber", "refno", "referenceno", "reference", "ref", "documentno", "docno", "invoice", "bill",
  ],
  invoiceDate: ["invoicedate", "billdate", "invdate", "vchdate", "voucherdate", "supplierinvoicedate", "docdate", "documentdate", "refdate", "date"],
  amount: [
    "pendingamount", "balanceamount", "outstandingamount", "outstanding", "amountdue", "dueamount", "balance", "pending",
    "billamount", "billamt", "invoiceamount", "invoicevalue", "billvalue", "netamount", "amount", "amt", "total", "value",
  ],
  vendor: [
    "partyname", "partysname", "suppliername", "vendorname", "ledgername", "particulars", "party", "supplier", "vendor",
    "ledger", "creditorname", "creditor", "distributorname", "distributor", "accountname", "name",
  ],
};

/** Substrings that disqualify a header in the fuzzy (contains) pass. */
const EXCLUDE: Record<MappingField, string[]> = {
  gstin: [],
  dueDate: ["days", "overdue"],
  invoiceNumber: ["date", "amount", "gst"],
  invoiceDate: ["due"],
  amount: ["days", "date", "overdue", "gst", "tax"],
  vendor: ["gst", "date", "invoice", "amount", "vch", "ref", "bill"],
};

// Claim order: specific fields first so e.g. "Due Date" isn't taken as invoice date, "Party GSTIN" as vendor.
const ORDER: MappingField[] = ["gstin", "dueDate", "invoiceNumber", "invoiceDate", "amount", "vendor"];

/** Guesses the column mapping from headers (Tally, Marg, Busy and generic exports). */
export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => ({ h, n: norm(h) }));
  const taken = new Set<string>();
  const out: ColumnMapping = {};

  // Pass 1: exact synonym matches, in synonym preference order.
  for (const f of ORDER) {
    for (const syn of SYNONYMS[f]) {
      const hit = normalized.find((x) => x.n === syn && !taken.has(x.h));
      if (hit) {
        out[f] = hit.h;
        taken.add(hit.h);
        break;
      }
    }
  }
  // Pass 2: header contains a synonym (≥4 chars).
  for (const f of ORDER) {
    if (out[f]) continue;
    outer: for (const syn of SYNONYMS[f]) {
      if (syn.length < 4) continue;
      for (const x of normalized) {
        if (taken.has(x.h) || !x.n.includes(syn) || EXCLUDE[f].some((e) => x.n.includes(e))) continue;
        out[f] = x.h;
        taken.add(x.h);
        break outer;
      }
    }
  }
  return out;
}
