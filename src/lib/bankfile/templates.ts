import type { BankTemplateConfig } from "./schema";

/**
 * Seed bank templates. These are plain JSON-serialisable objects (no functions,
 * no Dates, all defaults spelled out) so a migration can insert them verbatim
 * (`JSON.stringify(ICICI_PLACEHOLDER_TEMPLATE)`).
 */

/**
 * PLACEHOLDER — NOT VERIFIED AGAINST ICICI.
 * A plausible ICICI Corporate Internet Banking (CIB) bulk-payment style layout.
 * Column names, mode codes ("N"/"R"/"I"/"M"), lengths and allowed characters are
 * best guesses. Every business must download the latest bulk-upload template
 * from their own ICICI CIB login and adjust this config before real use.
 */
export const ICICI_PLACEHOLDER_TEMPLATE: BankTemplateConfig = {
  key: "icici_placeholder",
  name: "ICICI (placeholder — verify against your bank's latest template)",
  bankName: "ICICI Bank",
  isPlaceholder: true,
  notes:
    "Placeholder layout modelled on a typical ICICI CIB bulk payment file. Verify column order, mode codes and limits against the template in your ICICI corporate net banking before uploading.",
  version: 1,
  fileType: "csv",
  delimiter: ",",
  includeHeader: true,
  lineEnding: "CRLF",
  trailingNewline: true,
  quote: "auto",
  bom: false,
  sheetName: "Payments",
  columns: [
    { header: "Payment Mode", field: "paymentMode" },
    { header: "Beneficiary Name", field: "beneficiaryName" },
    { header: "Beneficiary Account No", field: "accountNumber", maxLength: 18 },
    { header: "IFSC", field: "ifsc", maxLength: 11 },
    { header: "Amount", field: "amount" },
    { header: "Debit Account No", field: "debitAccount", maxLength: 18 },
    { header: "Value Date", field: "valueDate" },
    { header: "Remarks/Narration", field: "remarks" },
    { header: "Beneficiary Email", field: "email", maxLength: 50 },
    { header: "Beneficiary Mobile", field: "phone", maxLength: 10 },
  ],
  formats: { dateFormat: "DD/MM/YYYY", amountDecimals: 2 },
  text: {
    allowedChars: "A-Za-z0-9 .\\-/",
    maxNameLength: 35,
    maxRemarksLength: 30,
    uppercase: false,
  },
  paymentModeRule: {
    rtgsMinPaise: 2_00_000_00,
    defaultMode: "NEFT",
    sameBankMode: "FT",
    allowRtgs: true,
    allowImps: false,
    impsMaxPaise: 5_00_000_00,
    modeCodes: { NEFT: "N", RTGS: "R", IMPS: "M", FT: "I" },
  },
  maxRowsPerFile: 500,
  newPayeesAllowed: "unknown",
};

/** A neutral CSV most banks' "custom bulk upload" mappers can ingest. */
export const GENERIC_CSV_TEMPLATE: BankTemplateConfig = {
  key: "generic_csv",
  name: "Generic CSV",
  isPlaceholder: false,
  notes: "Neutral layout for banks that let you map columns during upload.",
  version: 1,
  fileType: "csv",
  delimiter: ",",
  includeHeader: true,
  lineEnding: "CRLF",
  trailingNewline: true,
  quote: "auto",
  bom: false,
  sheetName: "Payments",
  columns: [
    { header: "Sr No", field: "serial" },
    { header: "Payment Mode", field: "paymentMode" },
    { header: "Beneficiary Name", field: "beneficiaryName" },
    { header: "Account Number", field: "accountNumber" },
    { header: "IFSC", field: "ifsc" },
    { header: "Amount", field: "amount" },
    { header: "Debit Account", field: "debitAccount" },
    { header: "Value Date", field: "valueDate" },
    { header: "Remarks", field: "remarks" },
    { header: "Email", field: "email" },
    { header: "Phone", field: "phone" },
  ],
  formats: { dateFormat: "DD-MM-YYYY", amountDecimals: 2 },
  text: {
    allowedChars: "A-Za-z0-9 .,\\-/&()",
    maxNameLength: 50,
    maxRemarksLength: 60,
    uppercase: false,
  },
  paymentModeRule: {
    rtgsMinPaise: 2_00_000_00,
    defaultMode: "NEFT",
    allowRtgs: true,
    allowImps: true,
    impsMaxPaise: 5_00_000_00,
    modeCodes: { NEFT: "NEFT", RTGS: "RTGS", IMPS: "IMPS", FT: "FT" },
  },
  maxRowsPerFile: 5000,
  newPayeesAllowed: "unknown",
};

export const SEED_BANK_TEMPLATES: readonly BankTemplateConfig[] = [ICICI_PLACEHOLDER_TEMPLATE, GENERIC_CSV_TEMPLATE];
