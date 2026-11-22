import * as XLSX from "xlsx";
import { paiseToDecimalString } from "../money";
import {
  isValidAccountNumber,
  isValidEmail,
  isValidIfsc,
  isValidIndianMobile,
  normalizeAccount,
  normalizeIfsc,
  normalizePhone,
} from "../validation";
import {
  BankTemplateConfigSchema,
  PaymentModeRuleSchema,
  stripBrackets,
  type BankColumn,
  type BankDateFormat,
  type BankField,
  type BankTemplateConfig,
  type PaymentMode,
  type PaymentModeRule,
  type PaymentModeRuleInput,
  type TextRules,
} from "./schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BankFilePaymentInput {
  /** run_payment id */
  id: string;
  vendorId: string;
  vendorName: string;
  /** Vendor status === "verified". */
  verified: boolean;
  /** Latest bank-details version approved (and hold window passed). */
  bankDetailsApproved: boolean;
  accountNumber: string;
  ifsc: string;
  /** Integer paise. */
  amountPaise: number;
  /** Combined invoice numbers, e.g. "INV 101, 102 +3 more". Cleaned per template. */
  remarks: string;
  email?: string | null;
  phone?: string | null;
  isNewPayee: boolean;
  /** Beneficiary code registered at the bank; defaults to an alphanumeric form of vendorId. */
  beneficiaryCode?: string | null;
  upiId?: string | null;
  /** Explicit mode override; otherwise suggestPaymentMode() decides. */
  mode?: PaymentMode | null;
}

export interface BankFileInput {
  /** Parsed config or raw JSON from the DB (validated here). */
  template: BankTemplateConfig | unknown;
  workspaceSlug: string;
  runId: string;
  runShortId: string;
  /** Value date. ISO "YYYY-MM-DD" (a full ISO timestamp is accepted; its first 10 chars are used). */
  date: string;
  debitAccountNumber: string;
  debitIfsc?: string | null;
  /** Run total as stored; the file must equal it to the paisa. */
  runTotalPaise: number;
  payments: BankFilePaymentInput[];
}

export const BANK_ROW_ERROR_CODES = [
  "VENDOR_NOT_VERIFIED",
  "BANK_NOT_APPROVED",
  "MISSING_ACCOUNT",
  "INVALID_ACCOUNT",
  "MISSING_IFSC",
  "INVALID_IFSC",
  "INVALID_AMOUNT",
  "AMOUNT_NOT_WHOLE_RUPEES",
  "NAME_EMPTY_AFTER_CLEANING",
  "DUPLICATE_PAYEE",
  "DUPLICATE_ROW",
  "NEW_PAYEE_NOT_ALLOWED",
  "MODE_NOT_ALLOWED",
  "RTGS_BELOW_MINIMUM",
  "AMOUNT_ABOVE_IMPS_LIMIT",
  "FIELD_TOO_LONG",
] as const;
export type BankRowErrorCode = (typeof BANK_ROW_ERROR_CODES)[number];

export const BANK_ROW_WARNING_CODES = [
  "NAME_CLEANED",
  "NAME_TRUNCATED",
  "REMARKS_CLEANED",
  "REMARKS_TRUNCATED",
  "NEW_PAYEE_CHECK_BANK",
  "EMAIL_DROPPED",
  "PHONE_DROPPED",
] as const;
export type BankRowWarningCode = (typeof BANK_ROW_WARNING_CODES)[number];

export const BANK_FILE_ERROR_CODES = [
  "INVALID_TEMPLATE",
  "NO_PAYMENTS",
  "TOTAL_MISMATCH",
  "INVALID_DEBIT_ACCOUNT",
  "INVALID_DEBIT_IFSC",
  "INVALID_DATE",
  "INVALID_RUN_TOTAL",
] as const;
export type BankFileErrorCode = (typeof BANK_FILE_ERROR_CODES)[number];

export interface BankRowIssue<C extends string> {
  /** 1-based position in input.payments. */
  row: number;
  paymentId: string;
  vendorName: string;
  /** Logical field (BankField) or column header for FIELD_TOO_LONG. */
  field: string;
  code: C;
  /** English fallback; UI should translate by `code`. */
  message: string;
}
export type BankRowError = BankRowIssue<BankRowErrorCode>;
export type BankRowWarning = BankRowIssue<BankRowWarningCode>;

export interface BankFileError {
  code: BankFileErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** A payment row after cleaning, ready to be written. */
export interface PreparedBankRow {
  row: number;
  paymentId: string;
  vendorId: string;
  vendorName: string;
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
  amountPaise: number;
  amount: string;
  mode: PaymentMode;
  modeCode: string;
  remarks: string;
  email: string;
  phone: string;
  beneficiaryCode: string;
  upiId: string;
  valueDate: string;
}

export interface BankFileValidation {
  ok: boolean;
  rowErrors: BankRowError[];
  rowWarnings: BankRowWarning[];
  fileErrors: BankFileError[];
  rows: PreparedBankRow[];
  totalPaise: number;
  /** Number of files the run will be split into (maxRowsPerFile). */
  fileCount: number;
  /** Parsed template (null when invalid). */
  template: BankTemplateConfig | null;
}

export interface GeneratedBankFile {
  filename: string;
  mimeType: string;
  /** string for csv/txt, Uint8Array for xlsx. */
  content: string | Uint8Array;
  /** 1-based part number. */
  part: number;
  partCount: number;
  rowCount: number;
  totalPaise: number;
  rows: PreparedBankRow[];
}

export interface GeneratedBankFiles {
  files: GeneratedBankFile[];
  rowCount: number;
  totalPaise: number;
  warnings: BankRowWarning[];
}

export class BankFileValidationError extends Error {
  readonly validation: BankFileValidation;
  constructor(validation: BankFileValidation) {
    const n = validation.rowErrors.length + validation.fileErrors.length;
    super(`Bank file validation failed with ${n} error(s)`);
    this.name = "BankFileValidationError";
    this.validation = validation;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const BANK_FILE_MIME: Record<BankTemplateConfig["fileType"], string> = {
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDatePart(date: string): string | null {
  const d = date.slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
  return d;
}

/** Formats an ISO date ("YYYY-MM-DD") into a bank date format. */
export function formatBankDate(iso: string, format: BankDateFormat): string {
  const d = isoDatePart(iso);
  if (!d) throw new RangeError(`Invalid ISO date: ${iso}`);
  const [y, m, dd] = d.split("-");
  switch (format) {
    case "DD/MM/YYYY":
      return `${dd}/${m}/${y}`;
    case "DD-MM-YYYY":
      return `${dd}-${m}-${y}`;
    case "DD.MM.YYYY":
      return `${dd}.${m}.${y}`;
    case "YYYYMMDD":
      return `${y}${m}${dd}`;
    case "YYYY-MM-DD":
      return d;
    case "DDMMYYYY":
      return `${dd}${m}${y}`;
    case "DD-MMM-YYYY":
      return `${dd}-${MONTHS_SHORT[+m - 1]}-${y}`;
  }
}

/**
 * Cleans free text to a template's allowed characters and length. Cleaning is a
 * transformation, never an error: disallowed chars become spaces, accents are
 * stripped, "&" becomes "and" when not allowed, whitespace is collapsed.
 */
export function cleanBankText(
  input: string | null | undefined,
  rules: Pick<TextRules, "allowedChars" | "uppercase">,
  maxLength: number,
): { value: string; cleaned: boolean; truncated: boolean } {
  const original = (input ?? "").trim().replace(/\s+/g, " ");
  const cls = stripBrackets(rules.allowedChars);
  const allowed = new RegExp(`^[${cls}]$`);
  let s = original.normalize("NFKD").replace(/\p{M}/gu, "");
  if (rules.uppercase) s = s.toUpperCase();
  if (!allowed.test("&")) s = s.replace(/\s*&\s*/g, rules.uppercase ? " AND " : " and ");
  if (!allowed.test("'")) s = s.replace(/['’`]/g, "");
  s = s.replace(new RegExp(`[^${cls}]`, "gu"), " ").replace(/\s+/g, " ").trim();
  // Case-only changes from `uppercase` are not reported as cleaning.
  const cleaned = rules.uppercase ? s !== original.toUpperCase() : s !== original;
  let truncated = false;
  if (s.length > maxLength) {
    s = s.slice(0, maxLength).trimEnd();
    truncated = true;
  }
  return { value: s, cleaned, truncated };
}

function bankCode(ifsc: string | null | undefined): string | null {
  if (!ifsc) return null;
  const n = normalizeIfsc(ifsc);
  return isValidIfsc(n) ? n.slice(0, 4) : null;
}

/**
 * Suggests NEFT/RTGS/IMPS/FT:
 * 1. Same bank (beneficiary IFSC bank code == debit IFSC bank code) and rule.sameBankMode → FT.
 * 2. amount ≥ rtgsMinPaise and RTGS allowed → RTGS.
 * 3. defaultMode IMPS (when allowed and within impsMaxPaise) → IMPS.
 * 4. NEFT.
 */
export function suggestPaymentMode(
  amountPaise: number,
  beneficiaryIfsc: string | null | undefined,
  debitIfsc: string | null | undefined,
  rule: PaymentModeRuleInput = {},
): PaymentMode {
  const r: PaymentModeRule = PaymentModeRuleSchema.parse(rule);
  const bene = bankCode(beneficiaryIfsc);
  const debit = bankCode(debitIfsc);
  if (r.sameBankMode && bene && debit && bene === debit) return r.sameBankMode;
  if (r.allowRtgs && amountPaise >= r.rtgsMinPaise) return "RTGS";
  if (r.defaultMode === "IMPS" && r.allowImps && amountPaise <= r.impsMaxPaise) return "IMPS";
  return "NEFT";
}

const EXACT_FIELDS = new Set<BankField>([
  "serial",
  "paymentMode",
  "accountNumber",
  "ifsc",
  "amount",
  "debitAccount",
  "valueDate",
  "phone",
  "upiId",
  "email",
]);

function rawCellValue(col: BankColumn, row: PreparedBankRow, serial: number, debitAccount: string): string {
  switch (col.field) {
    case "serial":
      return String(serial);
    case "paymentMode":
      return row.modeCode;
    case "beneficiaryName":
      return row.beneficiaryName;
    case "accountNumber":
      return row.accountNumber;
    case "ifsc":
      return row.ifsc;
    case "amount":
      return row.amount;
    case "debitAccount":
      return debitAccount;
    case "remarks":
      return row.remarks;
    case "valueDate":
      return row.valueDate;
    case "email":
      return row.email || col.fixedValue || "";
    case "phone":
      return row.phone || col.fixedValue || "";
    case "beneficiaryCode":
      return row.beneficiaryCode;
    case "upiId":
      return row.upiId || col.fixedValue || "";
    case "fixed":
      return col.fixedValue ?? "";
  }
}

/** Renders one cell; returns overflow=true when an exact field does not fit. */
function renderCell(
  col: BankColumn,
  row: PreparedBankRow,
  serial: number,
  debitAccount: string,
): { value: string; overflow: boolean } {
  let v = rawCellValue(col, row, serial, debitAccount);
  const exact = EXACT_FIELDS.has(col.field);
  const limit = Math.min(col.maxLength ?? Infinity, col.pad?.length ?? Infinity);
  let overflow = false;
  if (v.length > limit) {
    if (exact) overflow = true;
    else v = v.slice(0, limit).trimEnd();
  }
  if (col.pad && v.length < col.pad.length) {
    const char = col.pad.char ?? " ";
    v = (col.pad.side ?? "right") === "left" ? v.padStart(col.pad.length, char) : v.padEnd(col.pad.length, char);
  }
  return { value: v, overflow };
}

function sanitizeSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "workspace"
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRun(input: BankFileInput): BankFileValidation {
  const rowErrors: BankRowError[] = [];
  const rowWarnings: BankRowWarning[] = [];
  const fileErrors: BankFileError[] = [];
  const rows: PreparedBankRow[] = [];

  const parsed = BankTemplateConfigSchema.safeParse(input.template);
  if (!parsed.success) {
    return {
      ok: false,
      rowErrors,
      rowWarnings,
      fileErrors: [
        {
          code: "INVALID_TEMPLATE",
          message: "Bank template configuration is invalid",
          details: { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        },
      ],
      rows,
      totalPaise: 0,
      fileCount: 0,
      template: null,
    };
  }
  const t = parsed.data;
  const rule = t.paymentModeRule;

  const isoDate = isoDatePart(input.date ?? "");
  if (!isoDate) fileErrors.push({ code: "INVALID_DATE", message: `Invalid value date: ${input.date}` });
  const valueDate = isoDate ? formatBankDate(isoDate, t.formats.dateFormat) : "";

  const debitAccount = normalizeAccount(input.debitAccountNumber ?? "");
  if (!isValidAccountNumber(debitAccount)) {
    fileErrors.push({ code: "INVALID_DEBIT_ACCOUNT", message: "Debit account number is missing or invalid" });
  }
  const debitIfsc = input.debitIfsc ? normalizeIfsc(input.debitIfsc) : null;
  if (debitIfsc && !isValidIfsc(debitIfsc)) {
    fileErrors.push({ code: "INVALID_DEBIT_IFSC", message: "Debit account IFSC is invalid" });
  }
  if (!input.payments.length) fileErrors.push({ code: "NO_PAYMENTS", message: "The run has no payments" });
  if (!Number.isSafeInteger(input.runTotalPaise) || input.runTotalPaise < 0) {
    fileErrors.push({ code: "INVALID_RUN_TOTAL", message: "Run total must be a non-negative integer (paise)" });
  }

  const seenIds = new Map<string, number>();
  const payeeRows = new Map<string, number[]>();
  let totalPaise = 0;

  input.payments.forEach((p, i) => {
    const rowNo = i + 1;
    const err = (field: string, code: BankRowErrorCode, message: string) =>
      rowErrors.push({ row: rowNo, paymentId: p.id, vendorName: p.vendorName, field, code, message });
    const warn = (field: string, code: BankRowWarningCode, message: string) =>
      rowWarnings.push({ row: rowNo, paymentId: p.id, vendorName: p.vendorName, field, code, message });

    if (seenIds.has(p.id)) {
      err("id", "DUPLICATE_ROW", `Same payment appears twice (also row ${seenIds.get(p.id)})`);
    } else seenIds.set(p.id, rowNo);

    if (!p.verified) err("vendor", "VENDOR_NOT_VERIFIED", "Vendor is not verified");
    if (!p.bankDetailsApproved) err("accountNumber", "BANK_NOT_APPROVED", "Bank details are not approved");

    const account = normalizeAccount(p.accountNumber ?? "");
    if (!account) err("accountNumber", "MISSING_ACCOUNT", "Account number is missing");
    else if (!isValidAccountNumber(account)) err("accountNumber", "INVALID_ACCOUNT", "Account number must be 9–18 digits");

    const ifsc = normalizeIfsc(p.ifsc ?? "");
    if (!ifsc) err("ifsc", "MISSING_IFSC", "IFSC is missing");
    else if (!isValidIfsc(ifsc)) err("ifsc", "INVALID_IFSC", "IFSC format is invalid");

    const amountOk = Number.isSafeInteger(p.amountPaise) && p.amountPaise > 0;
    if (!amountOk) err("amount", "INVALID_AMOUNT", "Amount must be greater than zero, in whole paise");
    else {
      totalPaise += p.amountPaise;
      if (t.formats.amountDecimals === 0 && p.amountPaise % 100 !== 0) {
        err("amount", "AMOUNT_NOT_WHOLE_RUPEES", "This bank template only accepts whole-rupee amounts");
      }
    }

    if (account && ifsc) {
      const key = `${account}|${ifsc}`;
      const list = payeeRows.get(key) ?? [];
      list.push(i);
      payeeRows.set(key, list);
    }

    if (p.isNewPayee) {
      if (t.newPayeesAllowed === "no") {
        err("accountNumber", "NEW_PAYEE_NOT_ALLOWED", "This bank file cannot pay a beneficiary not yet registered with the bank");
      } else if (t.newPayeesAllowed === "unknown") {
        warn("accountNumber", "NEW_PAYEE_CHECK_BANK", "New payee — your bank may require adding the beneficiary first");
      }
    }

    // Payment mode
    const suggested = suggestPaymentMode(amountOk ? p.amountPaise : 0, ifsc, debitIfsc, rule);
    const mode: PaymentMode = p.mode ?? suggested;
    if (p.mode) {
      if (p.mode === "IMPS") {
        if (!rule.allowImps) err("paymentMode", "MODE_NOT_ALLOWED", "IMPS is not allowed by this template");
        else if (amountOk && p.amountPaise > rule.impsMaxPaise) err("paymentMode", "AMOUNT_ABOVE_IMPS_LIMIT", "Amount is above the IMPS limit");
      } else if (p.mode === "RTGS") {
        if (!rule.allowRtgs) err("paymentMode", "MODE_NOT_ALLOWED", "RTGS is not allowed by this template");
        else if (amountOk && p.amountPaise < rule.rtgsMinPaise) err("paymentMode", "RTGS_BELOW_MINIMUM", "Amount is below the RTGS minimum");
      } else if (p.mode === "FT") {
        const same = bankCode(ifsc) !== null && bankCode(ifsc) === bankCode(debitIfsc);
        if (!rule.sameBankMode || !same) err("paymentMode", "MODE_NOT_ALLOWED", "Fund transfer is only for accounts in the same bank");
      }
    }

    // Text cleaning
    const name = cleanBankText(p.vendorName, t.text, t.text.maxNameLength);
    if (!name.value) err("beneficiaryName", "NAME_EMPTY_AFTER_CLEANING", "Beneficiary name has no allowed characters");
    else {
      if (name.cleaned) warn("beneficiaryName", "NAME_CLEANED", `Name will be written as "${name.value}"`);
      if (name.truncated) warn("beneficiaryName", "NAME_TRUNCATED", `Name shortened to ${t.text.maxNameLength} characters`);
    }
    const remarks = cleanBankText(p.remarks, t.text, t.text.maxRemarksLength);
    if (remarks.cleaned && (p.remarks ?? "").trim()) warn("remarks", "REMARKS_CLEANED", `Remarks will be written as "${remarks.value}"`);
    if (remarks.truncated) warn("remarks", "REMARKS_TRUNCATED", `Remarks shortened to ${t.text.maxRemarksLength} characters`);

    let email = (p.email ?? "").trim();
    if (email && !isValidEmail(email)) {
      warn("email", "EMAIL_DROPPED", "Invalid email left out of the file");
      email = "";
    }
    let phone = p.phone ? normalizePhone(p.phone) : "";
    if (phone && !isValidIndianMobile(phone)) {
      warn("phone", "PHONE_DROPPED", "Invalid mobile number left out of the file");
      phone = "";
    }

    rows.push({
      row: rowNo,
      paymentId: p.id,
      vendorId: p.vendorId,
      vendorName: p.vendorName,
      beneficiaryName: name.value,
      accountNumber: account,
      ifsc,
      amountPaise: p.amountPaise,
      amount: amountOk ? paiseToDecimalString(p.amountPaise, t.formats.amountDecimals) : "",
      mode,
      modeCode: rule.modeCodes[mode],
      remarks: remarks.value,
      email,
      phone,
      beneficiaryCode: (p.beneficiaryCode ?? p.vendorId).replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      upiId: (p.upiId ?? "").trim(),
      valueDate,
    });
  });

  for (const idxs of payeeRows.values()) {
    if (idxs.length < 2) continue;
    for (const i of idxs) {
      const p = input.payments[i];
      const others = idxs.filter((j) => j !== i).map((j) => j + 1);
      rowErrors.push({
        row: i + 1,
        paymentId: p.id,
        vendorName: p.vendorName,
        field: "accountNumber",
        code: "DUPLICATE_PAYEE",
        message: `Same account and IFSC as row ${others.join(", ")}`,
      });
    }
  }

  if (Number.isSafeInteger(input.runTotalPaise) && totalPaise !== input.runTotalPaise) {
    fileErrors.push({
      code: "TOTAL_MISMATCH",
      message: `File total ${paiseToDecimalString(totalPaise)} does not match run total ${paiseToDecimalString(input.runTotalPaise)}`,
      details: { filePaise: totalPaise, runPaise: input.runTotalPaise, differencePaise: totalPaise - input.runTotalPaise },
    });
  }

  // Column fit (exact fields that overflow maxLength/pad).
  const parts = chunk(rows, t.maxRowsPerFile);
  for (const part of parts) {
    part.forEach((r, i) => {
      for (const col of t.columns) {
        if (renderCell(col, r, i + 1, debitAccount).overflow) {
          rowErrors.push({
            row: r.row,
            paymentId: r.paymentId,
            vendorName: r.vendorName,
            field: col.header,
            code: "FIELD_TOO_LONG",
            message: `"${col.header}" is longer than the bank allows`,
          });
        }
      }
    });
  }

  rowErrors.sort((a, b) => a.row - b.row);
  rowWarnings.sort((a, b) => a.row - b.row);
  return {
    ok: rowErrors.length === 0 && fileErrors.length === 0,
    rowErrors,
    rowWarnings,
    fileErrors,
    rows,
    totalPaise,
    fileCount: rows.length ? parts.length : 0,
    template: t,
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function csvEscape(v: string, delimiter: string, mode: BankTemplateConfig["quote"]): string {
  if (mode === "never") return v;
  const needs = mode === "always" || v.includes('"') || v.includes("\n") || v.includes("\r") || (delimiter !== "" && v.includes(delimiter));
  return needs ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Builds the filename `{workspaceSlug}-{runShortId}-{YYYYMMDD}[-partN].{ext}`. */
export function bankFileName(opts: {
  workspaceSlug: string;
  runShortId: string;
  date: string;
  ext: string;
  part?: number;
  partCount?: number;
}): string {
  const d = isoDatePart(opts.date);
  const ymd = d ? d.replace(/-/g, "") : "00000000";
  const suffix = opts.partCount && opts.partCount > 1 ? `-part${opts.part}` : "";
  return `${sanitizeSlug(opts.workspaceSlug)}-${sanitizeSlug(opts.runShortId)}-${ymd}${suffix}.${opts.ext}`;
}

/**
 * Validates and generates the bank upload file(s). Throws BankFileValidationError
 * (with `.validation`) when validation fails — never produces a partial file.
 * Runs larger than template.maxRowsPerFile are split into several files.
 */
export function generateBankFile(input: BankFileInput): GeneratedBankFiles {
  const v = validateRun(input);
  if (!v.ok || !v.template) throw new BankFileValidationError(v);
  const t = v.template;
  const debitAccount = normalizeAccount(input.debitAccountNumber);
  const eol = t.lineEnding === "CRLF" ? "\r\n" : "\n";
  const parts = chunk(v.rows, t.maxRowsPerFile);

  const files: GeneratedBankFile[] = parts.map((partRows, pi) => {
    const header = t.columns.map((c) => c.header);
    const body = partRows.map((r, i) => t.columns.map((c) => renderCell(c, r, i + 1, debitAccount).value));
    const filename = bankFileName({
      workspaceSlug: input.workspaceSlug,
      runShortId: input.runShortId,
      date: input.date,
      ext: t.fileType,
      part: pi + 1,
      partCount: parts.length,
    });
    let content: string | Uint8Array;
    if (t.fileType === "xlsx") {
      const aoa = t.includeHeader ? [header, ...body] : body;
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, t.sheetName);
      const out: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true });
      content = new Uint8Array(out);
    } else {
      const lines = (t.includeHeader ? [header, ...body] : body).map((cells) =>
        cells.map((c) => csvEscape(c, t.delimiter, t.quote)).join(t.delimiter),
      );
      content = (t.bom ? "﻿" : "") + lines.join(eol) + (t.trailingNewline && lines.length ? eol : "");
    }
    return {
      filename,
      mimeType: BANK_FILE_MIME[t.fileType],
      content,
      part: pi + 1,
      partCount: parts.length,
      rowCount: partRows.length,
      totalPaise: partRows.reduce((s, r) => s + r.amountPaise, 0),
      rows: partRows,
    };
  });

  return { files, rowCount: v.rows.length, totalPaise: v.totalPaise, warnings: v.rowWarnings };
}
