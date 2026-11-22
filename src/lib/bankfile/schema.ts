import { z } from "zod";

/**
 * Bank bulk-upload templates are configuration (JSON stored in the DB), not code.
 * Every bank-specific detail lives in a BankTemplateConfig; the generator is generic.
 */

export const BANK_FIELDS = [
  "serial",
  "paymentMode",
  "beneficiaryName",
  "accountNumber",
  "ifsc",
  "amount",
  "debitAccount",
  "remarks",
  "valueDate",
  "email",
  "phone",
  "beneficiaryCode",
  "upiId",
  "fixed",
] as const;
export type BankField = (typeof BANK_FIELDS)[number];

export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "FT"] as const;
/** FT = intra-bank fund transfer (beneficiary account in the same bank as the debit account). */
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const DATE_FORMATS = ["DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY", "YYYYMMDD", "YYYY-MM-DD", "DDMMYYYY", "DD-MMM-YYYY"] as const;
export type BankDateFormat = (typeof DATE_FORMATS)[number];

export const PadSchema = z.object({
  /** Pad to exactly this width (values longer than `length` are an error for exact fields, truncated for text). */
  length: z.number().int().positive(),
  char: z.string().length(1).default(" "),
  side: z.enum(["left", "right"]).default("right"),
});

export const BankColumnSchema = z
  .object({
    header: z.string(),
    field: z.enum(BANK_FIELDS),
    /** Value for field "fixed" (also used as fallback when an optional field is empty). */
    fixedValue: z.string().optional(),
    /** Text fields are truncated to this; exact fields (account, IFSC, amount…) error if longer. */
    maxLength: z.number().int().positive().optional(),
    pad: PadSchema.optional(),
  })
  .refine((c) => c.field !== "fixed" || c.fixedValue !== undefined, {
    message: "fixedValue is required for field 'fixed'",
    path: ["fixedValue"],
  });
export type BankColumn = z.infer<typeof BankColumnSchema>;

export const PaymentModeRuleSchema = z.object({
  /** At or above this amount RTGS is suggested. Default ₹2,00,000. */
  rtgsMinPaise: z.number().int().nonnegative().default(2_00_000_00),
  /** Mode used when nothing else applies. */
  defaultMode: z.enum(["NEFT", "IMPS"]).default("NEFT"),
  /** Mode for intra-bank transfers (beneficiary IFSC bank code == debit IFSC bank code). Omit to disable. */
  sameBankMode: z.literal("FT").optional(),
  allowRtgs: z.boolean().default(true),
  allowImps: z.boolean().default(false),
  /** IMPS upper limit (₹5,00,000 by RBI rules at time of writing). */
  impsMaxPaise: z.number().int().positive().default(5_00_000_00),
  /** What each mode is written as in the file (e.g. ICICI-style single-letter codes). */
  modeCodes: z
    .object({
      NEFT: z.string(),
      RTGS: z.string(),
      IMPS: z.string(),
      FT: z.string(),
    })
    .default({ NEFT: "NEFT", RTGS: "RTGS", IMPS: "IMPS", FT: "FT" }),
});
export type PaymentModeRule = z.infer<typeof PaymentModeRuleSchema>;
export type PaymentModeRuleInput = z.input<typeof PaymentModeRuleSchema>;

function isValidCharClass(src: string): boolean {
  try {
    new RegExp(`[^${stripBrackets(src)}]`, "g");
    return true;
  } catch {
    return false;
  }
}
/** `allowedChars` may be written as "A-Za-z0-9 " or "[A-Za-z0-9 ]". */
export function stripBrackets(src: string): string {
  return src.startsWith("[") && src.endsWith("]") ? src.slice(1, -1) : src;
}

export const TextRulesSchema = z.object({
  /** Regex character-class source of allowed characters, e.g. "A-Za-z0-9 .\\-/". Others are replaced by spaces. */
  allowedChars: z.string().min(1).refine(isValidCharClass, "allowedChars must be a valid regex character class"),
  maxNameLength: z.number().int().positive(),
  maxRemarksLength: z.number().int().positive(),
  uppercase: z.boolean().default(false),
});
export type TextRules = z.infer<typeof TextRulesSchema>;

export const BankTemplateConfigSchema = z.object({
  /** Stable key, e.g. "icici_placeholder". */
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  bankName: z.string().optional(),
  /** True for templates not verified against a real bank spec. UI should show a warning. */
  isPlaceholder: z.boolean().default(false),
  notes: z.string().optional(),
  version: z.number().int().positive().default(1),

  fileType: z.enum(["csv", "xlsx", "txt"]),
  /** Field separator for csv/txt. "" = fixed-width (use column pad). Ignored for xlsx. */
  delimiter: z.string().default(","),
  includeHeader: z.boolean().default(true),
  lineEnding: z.enum(["CRLF", "LF"]).default("CRLF"),
  trailingNewline: z.boolean().default(true),
  /** Quote csv values: "auto" = only when needed (delimiter, quote, newline). */
  quote: z.enum(["auto", "always", "never"]).default("auto"),
  bom: z.boolean().default(false),
  sheetName: z.string().min(1).max(31).default("Payments"),

  columns: z.array(BankColumnSchema).min(1),
  formats: z.object({
    dateFormat: z.enum(DATE_FORMATS),
    amountDecimals: z.union([z.literal(0), z.literal(2)]),
  }),
  text: TextRulesSchema,
  paymentModeRule: PaymentModeRuleSchema,
  /** Larger runs are split into multiple files. */
  maxRowsPerFile: z.number().int().positive(),
  /** Whether the bank accepts payees not yet registered as beneficiaries in net banking. */
  newPayeesAllowed: z.enum(["yes", "no", "unknown"]),
});

/** Parsed (defaults applied) template. */
export type BankTemplateConfig = z.infer<typeof BankTemplateConfigSchema>;
/** JSON shape as stored in the DB (defaults optional). */
export type BankTemplateConfigInput = z.input<typeof BankTemplateConfigSchema>;

export function parseBankTemplateConfig(json: unknown): BankTemplateConfig {
  return BankTemplateConfigSchema.parse(json);
}
