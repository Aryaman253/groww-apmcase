import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  ImportPresetSchema,
  SAMPLE_VENDOR_NAMES,
  buildSampleBills,
  buildSampleExportWorkbook,
  guessMapping,
  mapRows,
  missingRequiredMappings,
  parseImportAmount,
  readSpreadsheet,
} from ".";
import type { Bill } from "../payments";

const enc = (s: string) => new TextEncoder().encode(s);
const xlsxBuffer = (aoa: unknown[][], sheet = "Sheet1"): ArrayBuffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
const serial = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
};

const vendors = [
  { id: "v-sun", name: "Sunrise Pharma Distributors", gstin: null, creditDays: 30 },
  { id: "v-gan", name: "Ganga Medical Agencies", gstin: "27AAPFU0939F1ZV", creditDays: 15 },
  { id: "v-bal", name: "Shree Balaji Surgicals", gstin: null, creditDays: null },
];

describe("readSpreadsheet", () => {
  it("reads a Marg-like CSV, keeping values as text (day-first dates intact)", () => {
    const csv =
      "﻿Bill No,Bill Date,Party Name,Bill Amt,Balance,Due Date\r\n" +
      'MRG-001,05/03/2026,Sunrise Pharma Distributors,"1,23,456.50","1,23,456.50",04/04/2026\r\n' +
      ",,,,,\r\n" +
      "MRG-002,06/03/2026,Ganga Medical Agencies,500,250.25,\r\n";
    const { sheets } = readSpreadsheet(enc(csv).buffer as ArrayBuffer, "marg.csv");
    expect(sheets).toHaveLength(1);
    const s = sheets[0];
    expect(s.headerRowNumber).toBe(1);
    expect(s.headers).toEqual(["Bill No", "Bill Date", "Party Name", "Bill Amt", "Balance", "Due Date"]);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toEqual({
      "Bill No": "MRG-001",
      "Bill Date": "05/03/2026",
      "Party Name": "Sunrise Pharma Distributors",
      "Bill Amt": "1,23,456.50",
      Balance: "1,23,456.50",
      "Due Date": "04/04/2026",
    });
    expect(s.rows[1]["Due Date"]).toBeNull();
    expect(s.rowNumbers).toEqual([2, 4]);
  });

  it("detects the header below Tally title rows in XLSX", () => {
    const buf = xlsxBuffer([
      ["Demo Medical Store"],
      ["Bills Payable"],
      ["1-Oct-2026 to 20-Nov-2026"],
      [],
      ["Date", "Ref. No.", "Party's Name", "GSTIN/UIN", "Pending Amount", "Due on", "Overdue by days"],
      [serial("2026-10-01"), "DEMO/INV/1042", "Ganga Medical Agencies", "27AAPFU0939F1ZV", 12345.5, serial("2026-10-16"), 35],
      [serial("2026-10-05"), 1043, "Unknown New Party", "", 999, null, null],
      [null, null, "Grand Total", 13344.5, null, null],
    ]);
    const s = readSpreadsheet(buf, "tally.xlsx").sheets[0];
    expect(s.headerRowNumber).toBe(5);
    expect(s.headers[2]).toBe("Party's Name");
    expect(s.rows).toHaveLength(3);
    expect(s.rows[0]["Pending Amount"]).toBe(12345.5);
    expect(s.rowNumbers[0]).toBe(6);
  });

  it("honours headerRowHint, de-duplicates and fills blank headers", () => {
    const csv = "a,b,c\nInvoice,Amount,Amount,\nX1,10,20,extra\n";
    const s = readSpreadsheet(enc(csv), "x.csv", { headerRowHint: 2 }).sheets[0];
    expect(s.headers).toEqual(["Invoice", "Amount", "Amount (2)"]);
    expect(s.rows).toEqual([{ Invoice: "X1", Amount: "10", "Amount (2)": "20" }]);
  });

  it("decodes Windows-1252 CSV", () => {
    const bytes = new Uint8Array([...enc("Party,Bill No,Amount\nCaf"), 0xe9, ...enc(" Traders,1,10\n")]);
    expect(readSpreadsheet(bytes, "a.csv").sheets[0].rows[0].Party).toBe("Café Traders");
  });
});

describe("guessMapping", () => {
  it("maps Tally Bills Payable headers", () => {
    expect(guessMapping(["Date", "Ref. No.", "Party's Name", "GSTIN/UIN", "Pending Amount", "Due on", "Overdue by days"])).toEqual({
      invoiceDate: "Date",
      invoiceNumber: "Ref. No.",
      vendor: "Party's Name",
      gstin: "GSTIN/UIN",
      amount: "Pending Amount",
      dueDate: "Due on",
    });
  });
  it("maps Marg headers, preferring balance over bill amount", () => {
    expect(guessMapping(["Bill No", "Bill Date", "Party Name", "Bill Amt", "Balance", "Due Date", "GST No"])).toEqual({
      invoiceNumber: "Bill No",
      invoiceDate: "Bill Date",
      vendor: "Party Name",
      amount: "Balance",
      dueDate: "Due Date",
      gstin: "GST No",
    });
  });
  it("maps Tally day book / generic headers", () => {
    expect(guessMapping(["Date", "Particulars", "Vch Type", "Vch No.", "Credit"])).toMatchObject({
      invoiceDate: "Date",
      vendor: "Particulars",
      invoiceNumber: "Vch No.",
    });
    expect(guessMapping(["Supplier Name", "Supplier Invoice No", "Invoice Date", "Invoice Amount (Rs)", "Party GSTIN"])).toEqual({
      vendor: "Supplier Name",
      invoiceNumber: "Supplier Invoice No",
      invoiceDate: "Invoice Date",
      amount: "Invoice Amount (Rs)",
      gstin: "Party GSTIN",
    });
    expect(guessMapping(["foo", "bar"])).toEqual({});
  });
  it("reports missing required fields", () => {
    expect(missingRequiredMappings({ vendor: "Party" })).toEqual(["invoiceNumber", "amount"]);
  });
});

describe("ImportPreset", () => {
  it("validates presets", () => {
    const p = { name: "Tally Bills Payable", mapping: { vendor: "Party's Name", amount: "Pending Amount" }, headerRowHint: 5 };
    expect(ImportPresetSchema.parse(p)).toEqual(p);
    expect(ImportPresetSchema.safeParse({ name: "", mapping: {} }).success).toBe(false);
    expect(ImportPresetSchema.safeParse({ name: "x", mapping: { vendor: 3 } }).success).toBe(false);
    expect(ImportPresetSchema.safeParse({ name: "x", mapping: {}, headerRowHint: 0 }).success).toBe(false);
  });
});

describe("parseImportAmount", () => {
  it("handles Tally/Marg amount formats", () => {
    expect(parseImportAmount(12345.5)).toBe(1234550);
    expect(parseImportAmount("1,23,456.50")).toBe(12345650);
    expect(parseImportAmount("12,345.00 Cr")).toBe(1234500); // credit balance, not crore
    expect(parseImportAmount("500 Dr")).toBe(50000);
    expect(parseImportAmount("(500.00)")).toBe(-50000);
    expect(parseImportAmount("₹ 1,000")).toBe(100000);
    expect(parseImportAmount("abc")).toBeNull();
    expect(parseImportAmount(null)).toBeNull();
  });
});

describe("mapRows", () => {
  const existingBills: Bill[] = [{ id: "bill-old", vendorId: "v-sun", invoiceNumber: "MRG-0009", invoiceDate: "2026-02-01", amountPaise: 100_00 }];
  const mapping = {
    vendor: "Party",
    invoiceNumber: "Bill No",
    invoiceDate: "Date",
    amount: "Amount",
    dueDate: "Due",
    gstin: "GSTIN",
  };
  const row = (o: Record<string, unknown>) => ({ Party: null, "Bill No": null, Date: null, Amount: null, Due: null, GSTIN: null, ...o });

  it("maps, matches vendors, computes due dates and flags errors", () => {
    const rows = [
      row({ Party: "Sunrise Pharma Distributors", "Bill No": "MRG-001", Date: "05/03/2026", Amount: "1,000.50" }),
      row({ Party: "Some Other Name", GSTIN: "27aapfu0939f1zv", "Bill No": 1042, Date: serial("2026-03-01"), Amount: 99.99, Due: "10-Mar-2026" }),
      row({ Party: "Shree Balaji Surgical", "Bill No": "SB/1", Date: "2026-03-01", Amount: "250" }),
      row({ Party: "", "Bill No": "", Date: "31/02/2026", Amount: "abc" }),
      row({ Party: "Brand New Traders", "Bill No": "N-1", Amount: "-50", GSTIN: "BADGSTIN" }),
      row({ Party: "Grand Total", Amount: "1350.49" }),
    ];
    const out = mapRows(rows, mapping, { vendors, existingBills, defaultCreditDays: 7 });

    expect(out[0]).toMatchObject({
      index: 0,
      vendorName: "Sunrise Pharma Distributors",
      invoiceNumber: "MRG-001",
      invoiceDate: "2026-03-05",
      dueDate: "2026-04-04", // vendor credit 30 days
      amountPaise: 100050,
      creditDaysUsed: 30,
      errors: [],
      warnings: ["DUE_DATE_COMPUTED"],
      duplicateOf: null,
      skipped: false,
    });
    expect(out[0].vendorMatch).toMatchObject({ kind: "exact", match: { id: "v-sun" } });

    expect(out[1]).toMatchObject({ invoiceNumber: "1042", invoiceDate: "2026-03-01", dueDate: "2026-03-10", amountPaise: 9999, errors: [], warnings: [] });
    expect(out[1].vendorMatch).toMatchObject({ kind: "gstin", match: { id: "v-gan" } });
    expect(out[1].gstin).toBe("27AAPFU0939F1ZV");

    // fuzzy → suggestion only, default credit days
    expect(out[2].vendorMatch.match).toBeNull();
    expect(out[2].vendorMatch.suggestions[0].vendor.id).toBe("v-bal");
    expect(out[2].warnings).toEqual(["DUE_DATE_COMPUTED", "VENDOR_SUGGESTIONS"]);
    expect(out[2].dueDate).toBe("2026-03-08");

    expect(out[3].errors).toEqual(["MISSING_VENDOR", "MISSING_INVOICE_NUMBER", "INVALID_AMOUNT", "INVALID_DATE"]);
    expect(out[4].errors).toEqual(["NON_POSITIVE_AMOUNT"]);
    expect(out[4].warnings).toEqual(["MISSING_INVOICE_DATE", "INVALID_GSTIN", "NEW_VENDOR"]);
    expect(out[5]).toMatchObject({ skipped: true, errors: [], warnings: [] });
  });

  it("de-duplicates within the file and against existing bills", () => {
    const rows = [
      row({ Party: "Sunrise Pharma Distributors", "Bill No": "MRG-009", Date: "2026-03-01", Amount: "1" }),
      row({ Party: "Brand New Traders", "Bill No": "N-1", Date: "2026-03-01", Amount: "10" }),
      row({ Party: "brand new traders.", "Bill No": "n 01", Date: "2026-03-02", Amount: "11" }),
      row({ Party: "Brand New Traders", "Bill No": "N-2", Date: "2026-03-01", Amount: "10" }),
      row({ Party: "Ganga Medical Agencies", "Bill No": "N-1", Date: "2026-03-01", Amount: "10" }),
    ];
    const out = mapRows(rows, mapping, { vendors, existingBills, defaultCreditDays: 0 });
    expect(out[0].errors).toEqual(["ALREADY_IMPORTED"]);
    expect(out[0].duplicateOf).toEqual({ kind: "existing", billId: "bill-old", reason: "same_invoice_number" });
    expect(out[1].duplicateOf).toBeNull();
    expect(out[2].errors).toEqual(["DUPLICATE_IN_FILE"]);
    expect(out[2].duplicateOf).toEqual({ kind: "file", index: 1, reason: "same_invoice_number" });
    expect(out[3].errors).toEqual([]);
    expect(out[3].warnings).toContain("POSSIBLE_DUPLICATE_IN_FILE");
    expect(out[3].duplicateOf).toEqual({ kind: "file", index: 1, reason: "same_amount_and_date" });
    expect(out[4].duplicateOf).toBeNull(); // different vendor
  });
});

describe("sample export", () => {
  it("uses the 24 demo vendors with DEMO/INV numbers", () => {
    expect(SAMPLE_VENDOR_NAMES).toHaveLength(24);
    const bills = buildSampleBills();
    expect(new Set(bills.map((b) => b.vendorName)).size).toBe(24);
    expect(bills.every((b) => /^DEMO\/INV\/\d{4}$/.test(b.invoiceNumber) && Number.isInteger(b.amountPaise))).toBe(true);
    expect(bills.some((b) => b.vendorName.includes("Demo"))).toBe(false);
    expect(buildSampleBills()).toEqual(bills); // deterministic
  });

  it("round-trips through readSpreadsheet + guessMapping + mapRows", () => {
    const buf = XLSX.write(buildSampleExportWorkbook(), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const fromScript = readFileSync(path.join(process.cwd(), "public/samples/sample-bills-export.xlsx"));
    for (const data of [buf, new Uint8Array(fromScript)]) {
      const s = readSpreadsheet(data, "sample-bills-export.xlsx").sheets[0];
      expect(s.headerRowNumber).toBe(5);
      const mapping = guessMapping(s.headers);
      expect(missingRequiredMappings(mapping)).toEqual([]);
      const vs = SAMPLE_VENDOR_NAMES.map((name, i) => ({ id: `v${i}`, name, creditDays: 30 }));
      const out = mapRows(s.rows, mapping, { vendors: vs, existingBills: [], defaultCreditDays: 30 });
      const bills = buildSampleBills();
      const live = out.filter((r) => !r.skipped);
      expect(live).toHaveLength(bills.length);
      expect(live.every((r) => r.errors.length === 0 && r.vendorMatch.kind === "exact")).toBe(true);
      expect(live.map((r) => [r.invoiceNumber, r.invoiceDate, r.dueDate, r.amountPaise])).toEqual(
        bills.map((b) => [b.invoiceNumber, b.invoiceDate, b.dueDate, b.amountPaise]),
      );
      expect(out.filter((r) => r.skipped)).toHaveLength(1);
    }
  });
});
