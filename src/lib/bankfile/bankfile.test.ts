import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  BankFileValidationError,
  BankTemplateConfigSchema,
  GENERIC_CSV_TEMPLATE,
  BULK_PLACEHOLDER_TEMPLATE,
  SEED_BANK_TEMPLATES,
  bankFileName,
  cleanBankText,
  formatBankDate,
  generateBankFile,
  suggestPaymentMode,
  validateRun,
  type BankFileInput,
  type BankFilePaymentInput,
  type BankTemplateConfig,
} from ".";

const GOLDEN_DIR = path.join(__dirname, "__golden__");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/** Obviously fictional payees, dummy account numbers, fake bank codes. */
function fixturePayments(): BankFilePaymentInput[] {
  return [
    {
      id: "rp-0001",
      vendorId: "v-alpha",
      vendorName: "Test Vendor Alpha & Sons",
      verified: true,
      bankDetailsApproved: true,
      accountNumber: "0001 1122 2333",
      ifsc: "demo0000001",
      amountPaise: 12345650,
      remarks: "DEMO/INV/1042, 1043",
      email: "alpha@example.com",
      phone: "+91 98765 43210",
      isNewPayee: false,
    },
    {
      id: "rp-0002",
      vendorId: "v-beta",
      vendorName: "Démo Trädérs (Fictional) Pvt. Ltd.",
      verified: true,
      bankDetailsApproved: true,
      accountNumber: "999988887777",
      ifsc: "FAKE0000009",
      amountPaise: 25000000, // ₹2,50,000 → RTGS
      remarks: "DEMO/INV/2001; DEMO/INV/2002 +3 more",
      isNewPayee: true,
    },
    {
      id: "rp-0003",
      vendorId: "v-gamma",
      vendorName: "Sample Same-Bank Supplier",
      verified: true,
      bankDetailsApproved: true,
      accountNumber: "123412341234",
      ifsc: "TEST0000002",
      amountPaise: 99,
      remarks: "",
      email: "not-an-email",
      isNewPayee: false,
    },
  ];
}

function fixtureInput(template: unknown, payments = fixturePayments()): BankFileInput {
  return {
    template,
    workspaceSlug: "Demo Store",
    runId: "11111111-2222-3333-4444-555555555555",
    runShortId: "R0007",
    date: "2026-11-22",
    debitAccountNumber: "000000123456789",
    debitIfsc: "TEST0000001",
    runTotalPaise: payments.reduce((s, p) => s + p.amountPaise, 0),
    payments,
  };
}

const PIPE_TXT_TEMPLATE: BankTemplateConfig = BankTemplateConfigSchema.parse({
  key: "test_pipe_txt",
  name: "Test pipe-delimited TXT",
  fileType: "txt",
  delimiter: "|",
  includeHeader: false,
  lineEnding: "LF",
  columns: [
    { header: "SR", field: "serial", pad: { length: 4, char: "0", side: "left" } },
    { header: "MODE", field: "paymentMode" },
    { header: "NAME", field: "beneficiaryName", pad: { length: 20 } },
    { header: "ACCOUNT", field: "accountNumber" },
    { header: "IFSC", field: "ifsc" },
    { header: "AMT", field: "amount", pad: { length: 12, char: "0", side: "left" } },
    { header: "DATE", field: "valueDate" },
    { header: "CODE", field: "beneficiaryCode", maxLength: 8 },
    { header: "TYPE", field: "fixed", fixedValue: "VENDOR" },
    { header: "NARR", field: "remarks" },
  ],
  formats: { dateFormat: "YYYYMMDD", amountDecimals: 2 },
  text: { allowedChars: "A-Z0-9 ", maxNameLength: 20, maxRemarksLength: 20, uppercase: true },
  paymentModeRule: { sameBankMode: "FT" },
  maxRowsPerFile: 100,
  newPayeesAllowed: "yes",
});

function golden(name: string, actual: string) {
  const file = path.join(GOLDEN_DIR, name);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, actual, "utf8");
  }
  const expected = readFileSync(file);
  expect(Buffer.from(actual, "utf8").equals(expected), `${name} differs from golden file`).toBe(true);
}

describe("templates", () => {
  it("seed templates are valid, fully specified and JSON-serialisable", () => {
    for (const t of SEED_BANK_TEMPLATES) {
      const roundTrip = JSON.parse(JSON.stringify(t));
      expect(roundTrip).toEqual(t);
      expect(BankTemplateConfigSchema.parse(roundTrip)).toEqual(t);
    }
    expect(BULK_PLACEHOLDER_TEMPLATE.key).toBe("bulk_placeholder");
    expect(BULK_PLACEHOLDER_TEMPLATE.name).toBe("Bank bulk upload (placeholder — verify against your bank's latest template)");
    expect(BULK_PLACEHOLDER_TEMPLATE.isPlaceholder).toBe(true);
    expect(GENERIC_CSV_TEMPLATE.key).toBe("generic_csv");
    expect(GENERIC_CSV_TEMPLATE.name).toBe("Generic CSV");
  });
  it("rejects bad configs", () => {
    expect(BankTemplateConfigSchema.safeParse({ ...GENERIC_CSV_TEMPLATE, columns: [] }).success).toBe(false);
    expect(
      BankTemplateConfigSchema.safeParse({ ...GENERIC_CSV_TEMPLATE, columns: [{ header: "X", field: "fixed" }] }).success,
    ).toBe(false);
    expect(
      BankTemplateConfigSchema.safeParse({ ...GENERIC_CSV_TEMPLATE, text: { ...GENERIC_CSV_TEMPLATE.text, allowedChars: "a-" + "\\" } })
        .success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("formats dates", () => {
    expect(formatBankDate("2026-11-02", "DD/MM/YYYY")).toBe("02/11/2026");
    expect(formatBankDate("2026-11-02", "DD-MM-YYYY")).toBe("02-11-2026");
    expect(formatBankDate("2026-11-02", "YYYYMMDD")).toBe("20261102");
    expect(formatBankDate("2026-11-02T10:00:00Z", "DD-MMM-YYYY")).toBe("02-Nov-2026");
    expect(() => formatBankDate("2026-02-30", "YYYYMMDD")).toThrow();
  });
  it("cleans text", () => {
    const rules = { allowedChars: "A-Za-z0-9 .\\-/", uppercase: false };
    expect(cleanBankText("M/s. Shree Ganesh & Co.", rules, 35).value).toBe("M/s. Shree Ganesh and Co.");
    expect(cleanBankText("Café Ñandú's", rules, 35)).toEqual({ value: "Cafe Nandus", cleaned: true, truncated: false });
    expect(cleanBankText("ABCDEFGHIJ KLMN", rules, 11)).toEqual({ value: "ABCDEFGHIJ", cleaned: false, truncated: true });
    expect(cleanBankText("राम ट्रेडर्स", rules, 35).value).toBe("");
  });
  it("suggests payment mode", () => {
    const rule = BULK_PLACEHOLDER_TEMPLATE.paymentModeRule;
    expect(suggestPaymentMode(100_00, "DEMO0000001", "EFGH0000001", rule)).toBe("NEFT");
    expect(suggestPaymentMode(2_00_000_00, "DEMO0000001", "EFGH0000001", rule)).toBe("RTGS");
    expect(suggestPaymentMode(1_99_999_99, "DEMO0000001", "EFGH0000001", rule)).toBe("NEFT");
    expect(suggestPaymentMode(50_00_000_00, "efgh0009999", "EFGH0000001", rule)).toBe("FT");
    expect(suggestPaymentMode(100_00, "EFGH0009999", null, rule)).toBe("NEFT");
    expect(suggestPaymentMode(100_00, "EFGH0009999", "EFGH0000001", {})).toBe("NEFT"); // no sameBankMode
    expect(suggestPaymentMode(100_00, "X", "Y", { defaultMode: "IMPS", allowImps: true })).toBe("IMPS");
    expect(suggestPaymentMode(6_00_000_00, "X", "Y", { defaultMode: "IMPS", allowImps: true, allowRtgs: false })).toBe("NEFT");
  });
  it("builds file names", () => {
    expect(bankFileName({ workspaceSlug: "Demo Store", runShortId: "R0007", date: "2026-11-22", ext: "csv" })).toBe(
      "demo-store-r0007-20261122.csv",
    );
    expect(
      bankFileName({ workspaceSlug: "demo", runShortId: "R1", date: "2026-11-22", ext: "csv", part: 2, partCount: 3 }),
    ).toBe("demo-r1-20261122-part2.csv");
  });
});

describe("golden files", () => {
  for (const [template, name] of [
    [BULK_PLACEHOLDER_TEMPLATE, "bulk_placeholder.csv"],
    [GENERIC_CSV_TEMPLATE, "generic_csv.csv"],
    [PIPE_TXT_TEMPLATE, "test_pipe_txt.txt"],
  ] as const) {
    it(`matches ${name} byte-for-byte`, () => {
      const out = generateBankFile(fixtureInput(template));
      expect(out.files).toHaveLength(1);
      const f = out.files[0];
      expect(typeof f.content).toBe("string");
      expect(f.filename).toBe(`demo-store-r0007-20261122.${template.fileType}`);
      expect(out.totalPaise).toBe(12345650 + 25000000 + 99);
      golden(name, f.content as string);
    });
  }

  it("bulk placeholder rows look right", () => {
    const out = generateBankFile(fixtureInput(BULK_PLACEHOLDER_TEMPLATE));
    const lines = (out.files[0].content as string).split("\r\n");
    expect(lines[0]).toBe(
      "Payment Mode,Beneficiary Name,Beneficiary Account No,IFSC,Amount,Debit Account No,Value Date,Remarks/Narration,Beneficiary Email,Beneficiary Mobile",
    );
    expect(lines[1]).toBe(
      "N,Test Vendor Alpha and Sons,000111222333,DEMO0000001,123456.50,000000123456789,22/11/2026,DEMO/INV/1042 1043,alpha@example.com,9876543210",
    );
    expect(lines[2].startsWith("R,Demo Traders Fictional Pvt. Ltd.,")).toBe(true);
    expect(lines[3].startsWith("I,")).toBe(true); // same bank (TEST) → FT → "I"
    expect(lines[4]).toBe("");
    expect(out.files[0].mimeType).toBe("text/csv");
  });
});

describe("validateRun", () => {
  it("passes the fixture and reports cleaning warnings", () => {
    const v = validateRun(fixtureInput(BULK_PLACEHOLDER_TEMPLATE));
    expect(v.ok).toBe(true);
    const codes = v.rowWarnings.map((w) => `${w.row}:${w.code}`);
    expect(codes).toContain("1:NAME_CLEANED");
    expect(codes).toContain("2:NEW_PAYEE_CHECK_BANK");
    expect(codes).toContain("3:EMAIL_DROPPED");
    expect(v.fileCount).toBe(1);
  });

  it("reports per-row errors with stable codes", () => {
    const ps = fixturePayments();
    ps[0] = { ...ps[0], bankDetailsApproved: false };
    ps[1] = { ...ps[1], verified: false, ifsc: "FAKE1000009" };
    ps[2] = { ...ps[2], accountNumber: "12AB", amountPaise: 0, vendorName: "राम ट्रेडर्स" };
    const v = validateRun(fixtureInput(BULK_PLACEHOLDER_TEMPLATE, ps));
    expect(v.ok).toBe(false);
    const codes = v.rowErrors.map((e) => `${e.row}:${e.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "1:BANK_NOT_APPROVED",
        "2:VENDOR_NOT_VERIFIED",
        "2:INVALID_IFSC",
        "3:INVALID_ACCOUNT",
        "3:INVALID_AMOUNT",
        "3:NAME_EMPTY_AFTER_CLEANING",
      ]),
    );
    expect(v.rowErrors[0]).toMatchObject({ row: 1, vendorName: "Test Vendor Alpha & Sons", paymentId: "rp-0001" });
    expect(() => generateBankFile(fixtureInput(BULK_PLACEHOLDER_TEMPLATE, ps))).toThrow(BankFileValidationError);
  });

  it("requires the total to match to the paisa", () => {
    const input = { ...fixtureInput(GENERIC_CSV_TEMPLATE), runTotalPaise: 12345650 + 25000000 + 98 };
    const v = validateRun(input);
    expect(v.fileErrors.map((e) => e.code)).toEqual(["TOTAL_MISMATCH"]);
    expect(v.fileErrors[0].details).toMatchObject({ differencePaise: 1 });
    try {
      generateBankFile(input);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BankFileValidationError);
      expect((e as BankFileValidationError).validation.fileErrors[0].code).toBe("TOTAL_MISMATCH");
    }
  });

  it("detects duplicate payees and duplicate rows", () => {
    const ps = fixturePayments();
    ps.push({ ...ps[0], id: "rp-0009", vendorName: "Alpha again", accountNumber: "000111222333", ifsc: "DEMO0000001" });
    ps.push({ ...ps[1] });
    const v = validateRun(fixtureInput(GENERIC_CSV_TEMPLATE, ps));
    const codes = v.rowErrors.map((e) => `${e.row}:${e.code}`);
    expect(codes).toEqual(expect.arrayContaining(["1:DUPLICATE_PAYEE", "4:DUPLICATE_PAYEE", "5:DUPLICATE_ROW", "2:DUPLICATE_PAYEE"]));
  });

  it("file-level checks", () => {
    const v = validateRun({ ...fixtureInput(GENERIC_CSV_TEMPLATE, []), debitAccountNumber: "12", debitIfsc: "bad", date: "22/11/2026" });
    expect(v.fileErrors.map((e) => e.code).sort()).toEqual(["INVALID_DATE", "INVALID_DEBIT_ACCOUNT", "INVALID_DEBIT_IFSC", "NO_PAYMENTS"]);
    const bad = validateRun(fixtureInput({ key: "x" }));
    expect(bad.fileErrors[0].code).toBe("INVALID_TEMPLATE");
  });

  it("validates mode overrides, whole-rupee templates, new payees and field lengths", () => {
    const ps = fixturePayments();
    ps[0] = { ...ps[0], mode: "RTGS", amountPaise: 1000_00 };
    ps[1] = { ...ps[1], mode: "IMPS" };
    ps[2] = { ...ps[2], mode: "FT", ifsc: "DEMO0000002" };
    const strict: BankTemplateConfig = {
      ...GENERIC_CSV_TEMPLATE,
      formats: { ...GENERIC_CSV_TEMPLATE.formats, amountDecimals: 0 },
      paymentModeRule: { ...GENERIC_CSV_TEMPLATE.paymentModeRule, allowImps: false },
      newPayeesAllowed: "no",
      columns: [...GENERIC_CSV_TEMPLATE.columns, { header: "Short Acct", field: "accountNumber", maxLength: 6 }],
    };
    const v = validateRun(fixtureInput(strict, ps));
    const codes = v.rowErrors.map((e) => `${e.row}:${e.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "1:RTGS_BELOW_MINIMUM",
        "2:MODE_NOT_ALLOWED",
        "2:NEW_PAYEE_NOT_ALLOWED",
        "3:MODE_NOT_ALLOWED",
        "3:AMOUNT_NOT_WHOLE_RUPEES",
        "1:FIELD_TOO_LONG",
      ]),
    );
    expect(codes).not.toContain("1:AMOUNT_NOT_WHOLE_RUPEES");
    expect(v.rowErrors.find((e) => e.code === "FIELD_TOO_LONG")?.field).toBe("Short Acct");
  });
});

describe("splitting and xlsx", () => {
  it("splits into multiple files at maxRowsPerFile; serials restart per file", () => {
    const t: BankTemplateConfig = { ...GENERIC_CSV_TEMPLATE, maxRowsPerFile: 2 };
    const ps: BankFilePaymentInput[] = Array.from({ length: 5 }, (_, i) => ({
      id: `rp-${i}`,
      vendorId: `v-${i}`,
      vendorName: `Fictional Vendor ${i + 1}`,
      verified: true,
      bankDetailsApproved: true,
      accountNumber: `10000000000${i}`,
      ifsc: "DEMO0000001",
      amountPaise: 1000_00 + i,
      remarks: `DEMO/INV/${i}`,
      isNewPayee: false,
    }));
    const out = generateBankFile(fixtureInput(t, ps));
    expect(out.files.map((f) => f.filename)).toEqual([
      "demo-store-r0007-20261122-part1.csv",
      "demo-store-r0007-20261122-part2.csv",
      "demo-store-r0007-20261122-part3.csv",
    ]);
    expect(out.files.map((f) => f.rowCount)).toEqual([2, 2, 1]);
    expect(out.files.reduce((s, f) => s + f.totalPaise, 0)).toBe(out.totalPaise);
    expect((out.files[1].content as string).split("\r\n")[1].startsWith("1,NEFT,Fictional Vendor 3,")).toBe(true);
  });

  it("writes xlsx that reads back with SheetJS, keeping leading zeros as text", () => {
    const t: BankTemplateConfig = { ...BULK_PLACEHOLDER_TEMPLATE, key: "bulk_xlsx", fileType: "xlsx" };
    const out = generateBankFile(fixtureInput(t));
    const f = out.files[0];
    expect(f.content).toBeInstanceOf(Uint8Array);
    expect(f.filename).toBe("demo-store-r0007-20261122.xlsx");
    expect(f.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const wb = XLSX.read(f.content, { type: "array" });
    expect(wb.SheetNames).toEqual(["Payments"]);
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Payments, { header: 1, raw: true });
    expect(aoa[0]).toEqual(BULK_PLACEHOLDER_TEMPLATE.columns.map((c) => c.header));
    expect(aoa[1].slice(0, 7)).toEqual([
      "N",
      "Test Vendor Alpha and Sons",
      "000111222333",
      "DEMO0000001",
      "123456.50",
      "000000123456789",
      "22/11/2026",
    ]);
    expect(aoa).toHaveLength(4);
  });
});
