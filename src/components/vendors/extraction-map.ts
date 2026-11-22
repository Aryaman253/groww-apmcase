import type { ExtractionResult, VendorExtraction } from "@/lib/extract/types";
import type { ExtractionHints, FieldName, VendorFormValues } from "./vendor-form";

const MAP: [keyof VendorExtraction, FieldName][] = [
  ["accountHolderName", "accountHolderName"],
  ["accountNumber", "accountNumber"],
  ["ifsc", "ifsc"],
  ["bankName", "bankName"],
  ["upiId", "upiId"],
  ["gstin", "gstin"],
  ["phone", "phone"],
  ["email", "email"],
];

/** Turns an on-device extraction into editable form values + confidence/candidate hints. */
export function vendorExtractionToForm(res: ExtractionResult<VendorExtraction>, displayName?: string) {
  const initial: Partial<VendorFormValues> = {};
  const hints: ExtractionHints = {
    sourceType: res.meta.sourceType,
    engine: res.meta.engine,
    parserVersion: res.meta.parserVersion,
    durationMs: Math.round(res.meta.ms),
    confidence: {},
    candidates: {},
  };
  for (const [src, dst] of MAP) {
    const f = res.fields[src];
    if (f.value) initial[dst] = f.value;
    hints.confidence[dst] = f.value ? f.confidence : 0;
    if (f.candidates.length > 1 || (!f.value && f.candidates.length)) hints.candidates[dst] = f.candidates;
  }
  const holder = res.fields.accountHolderName.value;
  if (!displayName && holder) initial.displayName = titleCase(holder);
  else if (displayName) initial.displayName = displayName;
  const found = MAP.some(([src]) => res.fields[src].value || res.fields[src].candidates.length);
  return { initial, hints, found };
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
