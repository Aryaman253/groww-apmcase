/**
 * Text normalization shared by all field extractors. Works line by line and
 * never adds or removes lines, so per-line OCR confidences stay aligned.
 */

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

const PHONE_EMOJI = /[\u{1F4DE}\u{1F4F1}\u{1F4F2}\u{260E}\u{1F57B}\u{1F4F3}]\uFE0F?/gu;
// Pictographs, dingbats, flags, keycaps, variation selectors, ZWJ.
const EMOJI =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{20E3}\u{200D}]/gu;

const MISPLACED_I =
  /(?<![\u0915-\u0939\u0958-\u095F\u093C])\u093F((?:[\u0915-\u0939\u0958-\u095F]\u093C?\u094D)*[\u0915-\u0939\u0958-\u095F]\u093C?)/;

/**
 * True when Devanagari text is in visual (not logical) order — a dependent
 * vowel sign or virama right after a space, as produced by broken PDF text
 * layers ("ट ेडसर्"). Such text must not yield confident values.
 */
export function looksGarbledDevanagari(s: string): boolean {
  return /(?:^|[\s(])[\u093E-\u094D\u0962\u0963]/u.test(s);
}

export function normalizeLine(line: string): string {
  let s = line.normalize("NFKC");
  s = s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  // Phone emojis act as a label ("📞 98765 43210").
  s = s.replace(PHONE_EMOJI, " Ph: ");
  s = s.replace(EMOJI, " ");
  s = s
    .replace(/[\u200B\u200C\u2060\u00AD]/g, "") // zero-width, soft hyphen
    .replace(/[\u2010-\u2015\u2212]/g, "-") // dashes, minus
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\uFF1A\uFE55]/g, ":")
    .replace(/\t/g, "  ")
    .replace(/\u00A0/g, " ");
  // PDF text layers often store the pre-base vowel sign "ि" in visual order
  // ("िबल" for "बिल"): move a misplaced ि after the consonant cluster it belongs to.
  for (let k = 0; k < 4 && MISPLACED_I.test(s); k++) s = s.replace(MISPLACED_I, "$1\u093F");
  // OCR/UPI: "name @ ybl" → "name@ybl"
  s = s.replace(/([A-Za-z0-9._-])[ ]?@[ ]?([A-Za-z])/g, "$1@$2");
  // Common OCR misread of the rupee sign before a digit: "रे1,234" / "र1,234".
  s = s.replace(/(^|[\s:(])(?:रु\.?|रे|र|₨)\s?(?=\d)/g, "$1₹");
  return s.replace(/[ ]{3,}/g, "  ").trimEnd();
}

export function normalizeText(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map(normalizeLine);
}

/** Replaces [start,end) with '#' (keeps offsets; '#' breaks digit runs). */
export function maskRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + "#".repeat(Math.max(0, end - start)) + s.slice(end);
}

export function maskAll(s: string, re: RegExp): string {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return s.replace(g, (m) => "#".repeat(m.length));
}

const HINDI_MONTHS: [RegExp, string][] = [
  [/जनवरी/g, "jan"],
  [/फ़?फरवरी|फ़रवरी/g, "feb"],
  [/मार्च/g, "mar"],
  [/अप्रैल|अप्रेल/g, "apr"],
  [/मई/g, "may"],
  [/जून/g, "jun"],
  [/जुलाई/g, "jul"],
  [/अगस्त/g, "aug"],
  [/सितंबर|सितम्बर/g, "sep"],
  [/अक्टूबर|अक्तूबर/g, "oct"],
  [/नवंबर|नवम्बर/g, "nov"],
  [/दिसंबर|दिसम्बर/g, "dec"],
];

export function englishMonths(s: string): string {
  let out = s;
  for (const [re, en] of HINDI_MONTHS) out = out.replace(re, en);
  return out;
}

/** Letters/digits/marks — used for Unicode-aware word boundaries. */
export const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
