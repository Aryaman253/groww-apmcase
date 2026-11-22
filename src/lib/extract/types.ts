/**
 * Types for on-device auto-fill (vendor bank details + invoices).
 *
 * Every field is a FieldResult: the parser never guesses. When several
 * plausible values exist and no rule disambiguates them, `value` is null and
 * `candidates` lists the choices for the UI to offer as tappable chips.
 */

export type FieldSource = "text" | "ocr";

export interface FieldResult<T = string> {
  /** Chosen value, or null when absent or ambiguous. */
  value: T | null;
  /**
   * 0..1 from deterministic rules (validation, keyword nearby, number of
   * candidates, OCR confidence). >= 0.8 means "safe to pre-fill silently";
   * below that the UI should ask the user to confirm. 0 when value is null.
   */
  confidence: number;
  /**
   * Distinct plausible values, best first. When `value` is set it is
   * candidates[0] and the rest are alternatives; when `value` is null and
   * candidates is non-empty, the field is ambiguous.
   */
  candidates: T[];
  source?: FieldSource;
  /** Short machine-readable reasons, e.g. ["keyword", "checksum", "ocr-corrected"]. */
  evidence?: string[];
}

export interface VendorExtraction {
  accountHolderName: FieldResult<string>;
  /** Digits only. */
  accountNumber: FieldResult<string>;
  /** Uppercase, validated format. */
  ifsc: FieldResult<string>;
  /** Canonical bank name of the account being added, when the IFSC prefix is known. */
  bankName: FieldResult<string>;
  /** Lowercase VPA, e.g. "name@upihandle". */
  upiId: FieldResult<string>;
  /** Uppercase, checksum-validated. */
  gstin: FieldResult<string>;
  /** 10-digit Indian mobile. */
  phone: FieldResult<string>;
  /** Lowercase. */
  email: FieldResult<string>;
}

export interface InvoiceExtraction {
  /** Seller's GSTIN (buyer GSTIN / `ownGstin` are excluded). */
  vendorGstin: FieldResult<string>;
  vendorName: FieldResult<string>;
  invoiceNumber: FieldResult<string>;
  /** ISO YYYY-MM-DD */
  invoiceDate: FieldResult<string>;
  /** ISO YYYY-MM-DD, only when printed. Use computeDueDate() with creditDays otherwise. */
  dueDate: FieldResult<string>;
  /** Payable total in integer paise. */
  totalPaise: FieldResult<number>;
  /** "Net 30", "credit 30 days", "30 दिन" … */
  creditDays: FieldResult<number>;
}

export type VendorField = keyof VendorExtraction;
export type InvoiceField = keyof InvoiceExtraction;

export interface ParseOptions {
  /** Average OCR confidence (0..1) of the whole text. Marks the result as OCR-sourced. */
  ocrWordConfidence?: number;
  /** Per-line OCR confidence, aligned with text.split("\n"). Preferred over the average. */
  ocrLineConfidences?: number[];
}

export interface InvoiceParseOptions extends ParseOptions {
  /** The business's own GSTIN — never returned as the vendor GSTIN. */
  ownGstin?: string | null;
}

export type SourceType = "paste" | "image" | "pdf";
export type OcrEngine = "paddle" | "tesseract";
export type TextEngine = OcrEngine | "pdf-text";

export interface ExtractionMeta {
  parserVersion: string;
  sourceType: SourceType;
  /** How the text was obtained; undefined for pasted text. */
  engine?: TextEngine;
  /** Wall-clock time for OCR/text extraction + parsing. */
  ms: number;
  textLength: number;
  /** Average OCR confidence when OCR ran. */
  ocrConfidence?: number;
  /** Non-fatal issues, e.g. "paddle-unavailable: fell back to tesseract". */
  warnings?: string[];
}

export interface ExtractionResult<F> {
  fields: F;
  meta: ExtractionMeta;
  /** The text the parser saw (normalized OCR/PDF output or the pasted text). */
  text: string;
}

export type OcrLang = "en" | "hi";

/** Crop rectangle as fractions (0..1) of the EXIF-oriented image. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ExtractInput =
  | { kind: "text"; text: string }
  | { kind: "image"; file: Blob; lang?: OcrLang; crop?: CropRect }
  | { kind: "pdf"; file: Blob; lang?: OcrLang };

/** Progress stages reported to the UI. */
export type ExtractionStage = "loading" | "reading" | "parsing";

export interface ExtractCallOptions {
  onProgress?: (stage: ExtractionStage) => void;
}

/**
 * Pluggable extractor. Only the on-device implementation exists; the
 * interface leaves room for another backend without touching the UI.
 */
export interface Extractor {
  readonly id: string;
  extractVendor(input: ExtractInput, opts?: ExtractCallOptions): Promise<ExtractionResult<VendorExtraction>>;
  extractInvoice(
    input: ExtractInput,
    opts?: ExtractCallOptions & { ownGstin?: string | null },
  ): Promise<ExtractionResult<InvoiceExtraction>>;
}
