/** Shape of evals/fixtures/<id>.expected.json */
export interface FixtureSpec {
  id: string;
  kind: "vendor" | "invoice";
  sourceType: "paste" | "image" | "pdf";
  /** File name inside evals/fixtures/ */
  file: string;
  /** OCR language hint the app would pass. */
  lang: "en" | "hi";
  description: string;
  /** Ground truth per field; null = absent or genuinely ambiguous (parser must return null). */
  expected: Record<string, string | number | null>;
  /** For ambiguous fields: values that must appear in `candidates`. */
  candidates?: Record<string, (string | number)[]>;
  /** Rendered text (images/PDFs), used for OCR token recall. */
  groundTruthText?: string;
}
