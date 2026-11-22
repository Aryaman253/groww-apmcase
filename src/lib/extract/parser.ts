/**
 * Deterministic, rule-based parser for vendor bank details and invoices.
 * Pure and isomorphic: no DOM, no network, no randomness. Same input → same output.
 *
 * Pipeline:
 *   1. normalize lines (Devanagari digits, emojis, dashes, OCR quirks)
 *   2. find strongly-typed tokens per line (email, UPI, GSTIN, IFSC, PAN,
 *      dates, amounts) and mask them so their digits can't leak into others
 *   3. segment lines at keyword labels (labels.ts) so each value knows the
 *      label it sits under ("A/c: …", "Mob: …", "खाता संख्या: …")
 *   4. per field, build candidates with a tier (labelled < unlabelled …) and a
 *      rule-based confidence, then `decide()`: a single best-tier candidate
 *      wins; several distinct best-tier candidates → value null + candidates.
 */
import {
  gstinCheckChar,
  isValidEmail,
  isValidGstin,
  isValidIfsc,
  isValidIndianMobile,
  isValidUpi,
  nameMatchScore,
  normalizePhone,
} from "../validation";
import { parseAmountToPaise } from "../money";
import { parseIndianDate } from "../dates";
import { amountWordsToPaise } from "./amount-words";
import { bankFromIfsc, findBankMentions, UPI_HANDLES } from "./banks";
import { type LabelCat, type LabelHit, type Segment, type Span, segmentLines } from "./labels";
import { collapseSpaces, englishMonths, looksGarbledDevanagari, maskRange, normalizeText } from "./normalize";
import type {
  FieldResult,
  FieldSource,
  InvoiceExtraction,
  InvoiceParseOptions,
  ParseOptions,
  VendorExtraction,
} from "./types";

export const PARSER_VERSION = "1.0.0";

/** Values at or above this confidence are considered safe to pre-fill. */
export const CONFIDENT = 0.8;

// ───────────────────────────── regexes ─────────────────────────────

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/giu;
const EMAIL_RE = /(?<![\p{L}\p{N}._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\p{L}\p{N}])/gu;
const UPI_RE = /(?<![\p{L}\p{N}._-])([A-Za-z0-9][A-Za-z0-9._-]{1,255})@([A-Za-z][A-Za-z0-9]{1,63})(?![A-Za-z0-9-]|\.[A-Za-z])/gu;
// Loose shapes; OCR fixes + checksum/format validation happen afterwards.
const GSTIN_LOOSE = /(?<![A-Z0-9])([0-9OISBZ]{2}[A-Z0-9]{5}[0-9OISBZG]{4}[A-Z0-9]{4})(?![A-Z0-9])/g;
const IFSC_LOOSE = /(?<![A-Z0-9])([A-Z0-9]{4}[0O][A-Z0-9]{6})(?![A-Z0-9])/g;
const PAN_RE = /(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])/g;
const MONTH =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|जनवरी|फ़?फरवरी|फ़रवरी|मार्च|अप्रैल|अप्रेल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर";
const DATE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}/.\-])(` +
    String.raw`\d{4}-\d{1,2}-\d{1,2}` +
    String.raw`|\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})` +
    String.raw`|\d{1,2}(?:st|nd|rd|th)?[\s\-/.,]*(?:${MONTH})[a-z]*\.?[\s\-/.,']*(?:\d{4}|\d{2})` +
    String.raw`|(?:${MONTH})[a-z]*\.?\s*\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}` +
    String.raw`)(?![\p{L}\p{N}]|[/.\-]\d)`,
  "giu",
);
const AMOUNT_RE =
  /(?<![\p{L}\p{N}\p{M}.,/#-])(?:(₹|rs\.?|inr|rupees)\s*)?(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d{1,2})?(?:\s*\/-)?(?:\s*(lakhs?|lacs?|crores?|cr|लाख|करोड़))?(?![\p{L}\p{N}\p{M}]|[.,]\d|\s*%)/giu;
const PERCENT_RE = /\d+(?:\.\d+)?\s*%/g;
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi;
const RUN_RE = /(?<![\p{L}\p{N}\p{M}@._,/])\+?\d(?:[ -]?\d)*(?![\p{L}\p{N}\p{M}@]|[.,/]\d)/gu;

// ───────────────────────────── helpers ─────────────────────────────

interface Cand<T> {
  value: T;
  key: string;
  conf: number;
  /** 0 = strongest evidence (labelled), higher = weaker. */
  tier: number;
  evidence: string[];
}

function emptyField<T>(source: FieldSource): FieldResult<T> {
  return { value: null, confidence: 0, candidates: [], source };
}

/**
 * Picks a value only when the strongest tier holds exactly one distinct
 * candidate. `altPenalty` is subtracted when weaker-tier alternatives exist.
 */
function decide<T>(cands: Cand<T>[], source: FieldSource, altPenalty = 0.05): FieldResult<T> {
  if (!cands.length) return emptyField<T>(source);
  const groups = new Map<string, Cand<T>>();
  for (const c of cands) {
    const g = groups.get(c.key);
    if (!g || c.tier < g.tier) {
      groups.set(c.key, { ...c, evidence: uniq([...c.evidence, ...(g?.evidence ?? [])]) });
    } else {
      if (c.tier === g.tier) g.conf = Math.max(g.conf, c.conf);
      g.evidence = uniq([...g.evidence, ...c.evidence]);
    }
  }
  const all = [...groups.values()].sort((a, b) => a.tier - b.tier || b.conf - a.conf);
  const bestTier = all[0].tier;
  const best = all.filter((g) => g.tier === bestTier);
  const candidates = all.slice(0, 6).map((g) => g.value);
  if (best.length !== 1) {
    return { value: null, confidence: 0, candidates, source, evidence: ["ambiguous"] };
  }
  const w = best[0];
  const penalty = all.length > 1 ? altPenalty : 0;
  return {
    value: w.value,
    confidence: round(clamp(w.conf - penalty)),
    candidates,
    source,
    evidence: uniq(all.length > 1 ? [...w.evidence, "alternatives"] : w.evidence),
  };
}

function uniq<T>(a: T[]): T[] {
  return [...new Set(a)];
}
function clamp(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function round(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * OCR adjustment. Checksum-validated values (GSTIN) only get a mild factor;
 * unverifiable ones (digits, names, amounts) are capped below CONFIDENT when
 * the OCR line confidence is not high.
 */
function ocrAdjust(conf: number, lc: number | undefined, strong = false): number {
  if (lc === undefined) return conf;
  if (strong) return conf * (0.85 + 0.15 * lc);
  if (lc < 0.8) return Math.min(conf * lc, 0.6);
  if (lc < 0.9) return Math.min(conf, 0.79);
  return conf * (0.9 + 0.1 * lc);
}

const DIGIT_TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
const LETTER_TO_DIGIT: Record<string, string> = { O: "0", D: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8" };

function fixGstin(raw: string): { value: string; fixed: boolean } | null {
  const g = raw.toUpperCase();
  if (isValidGstin(g)) return { value: g, fixed: false };
  const chars = g.split("");
  const digitPos = [0, 1, 7, 8, 9, 10];
  const letterPos = [2, 3, 4, 5, 6, 11];
  for (const p of digitPos) chars[p] = LETTER_TO_DIGIT[chars[p]] ?? chars[p];
  for (const p of letterPos) chars[p] = DIGIT_TO_LETTER[chars[p]] ?? chars[p];
  if (chars[13] === "2") chars[13] = "Z";
  const fixedFirst14 = chars.slice(0, 14).join("");
  const candidate = fixedFirst14 + chars[14];
  if (isValidGstin(candidate)) return { value: candidate, fixed: true };
  // The check character itself may be misread (0/O, 1/I, 5/S …): recompute and
  // accept only if the read char is a known confusion of the computed one.
  const check = gstinCheckChar(fixedFirst14);
  const confusable = (a: string, b: string) => LETTER_TO_DIGIT[a] === b || DIGIT_TO_LETTER[a] === b;
  if (check && confusable(chars[14], check) && isValidGstin(fixedFirst14 + check)) {
    return { value: fixedFirst14 + check, fixed: true };
  }
  return null;
}

function fixIfsc(raw: string): { value: string; fixed: boolean } | null {
  const s = raw.toUpperCase();
  if (isValidIfsc(s) && /^[A-Z]{4}0/.test(s)) return { value: s, fixed: false };
  const head = s.slice(0, 4);
  if ((head.match(/[A-Z]/g) ?? []).length < 2) return null;
  const fixedHead = head.replace(/[0-9]/g, (d) => DIGIT_TO_LETTER[d] ?? d);
  const v = fixedHead + "0" + s.slice(5);
  return isValidIfsc(v) ? { value: v, fixed: v !== s } : null;
}

function nameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^m\s*\/\s*s\.?\s*/u, "")
    .replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

const HONORIFIC = /^(?:m\s*\/\s*s\.?|messrs\.?|mr\.?|mrs\.?|ms\.?|मेसर्स)\s+/iu;
const TRAILING_FILLER = /\s+(?:hai|है|h|ji|जी|only)$/iu;
const ROLE = /\s*\((?:prop\.?|proprietor|owner|partner|director|प्रोप्राइटर|मालिक)\)\s*$/iu;

/** Cleans a name-like value; returns null when it does not look like a name. */
export function cleanName(raw: string): string | null {
  let s = raw.replace(/^[\s"'“”:.\-–*|]+/u, "").split(/\s{2,}|\s\|\s|[;,]|\s-\s|\s–\s/u)[0] ?? "";
  s = s.replace(/^[\s"'“”:.\-*]+|[\s"'“”:.\-*,]+$/gu, "");
  s = s.replace(HONORIFIC, "").replace(TRAILING_FILLER, "").replace(ROLE, "");
  s = collapseSpaces(s.replace(/[\s"'“”:.\-*,]+$/u, ""));
  if (s.length < 2 || s.length > 80) return null;
  if (/@|https?:|www\./i.test(s)) return null;
  if (looksGarbledDevanagari(s)) return null;
  if ((s.match(/\d/g) ?? []).length > 2) return null;
  if ((s.match(/[\p{L}]/gu) ?? []).length < 2) return null;
  return s;
}

/**
 * Names read by OCR in Devanagari are unverifiable and the mobile Devanagari
 * recognizer confuses conjuncts (न्न/न्र): never confident.
 */
function capOcrName(r: FieldResult<string>, doc: Doc): FieldResult<string> {
  if (doc.ocr && r.value && /[\u0900-\u097F]/.test(r.value) && r.confidence > 0.75) {
    return { ...r, confidence: 0.75, evidence: [...(r.evidence ?? []), "ocr-devanagari"] };
  }
  return r;
}

// ─────────────────────────── analysis ───────────────────────────

interface Found {
  line: number;
  start: number;
  end: number;
  value: string;
  fixed?: boolean;
}
interface DateFound extends Found {
  iso: string;
}
interface AmountFound extends Found {
  paise: number;
  formatted: boolean;
}
interface Run {
  line: number;
  start: number;
  raw: string;
  digits: string;
  groups: string[];
}

interface Doc {
  lines: string[];
  lineConf: (number | undefined)[];
  ocr: boolean;
  source: FieldSource;
  segments: Segment[];
  labelCats: Set<LabelCat>[];
  labelHits: LabelHit[][];
  emails: Found[];
  upis: Found[];
  gstins: Found[];
  ifscs: Found[];
  banks: Found[];
  dates: DateFound[];
  amounts: AmountFound[];
  runs: Run[];
}

function analyze(text: string, opts: ParseOptions = {}): Doc {
  const lines = normalizeText(text);
  const ocr = opts.ocrWordConfidence !== undefined || (opts.ocrLineConfidences?.length ?? 0) > 0;
  const lineConf = lines.map((_, i) => opts.ocrLineConfidences?.[i] ?? opts.ocrWordConfidence);
  const protect: Span[][] = [];
  const emails: Found[] = [];
  const upis: Found[] = [];
  const gstins: Found[] = [];
  const ifscs: Found[] = [];
  const banks: Found[] = [];
  const dates: DateFound[] = [];
  const amounts: AmountFound[] = [];
  const runs: Run[] = [];

  lines.forEach((line, i) => {
    const spans: Span[] = [];
    let masked = line;
    const take = (re: RegExp, cb?: (m: RegExpExecArray) => void) => {
      re.lastIndex = 0;
      for (const m of masked.matchAll(re) as IterableIterator<RegExpExecArray>) {
        spans.push({ start: m.index, end: m.index + m[0].length });
        cb?.(m);
      }
      for (const s of spans) masked = maskRange(masked, s.start, s.end);
    };
    take(URL_RE);
    take(EMAIL_RE, (m) => {
      if (isValidEmail(m[0])) emails.push({ line: i, start: m.index, end: m.index + m[0].length, value: m[0].toLowerCase() });
    });
    take(UPI_RE, (m) => {
      if (isValidUpi(m[0])) upis.push({ line: i, start: m.index, end: m.index + m[0].length, value: m[0].toLowerCase() });
    });
    const textSpans = [...spans];
    for (const b of findBankMentions(masked)) {
      banks.push({ line: i, start: b.start, end: b.end, value: b.name });
      textSpans.push({ start: b.start, end: b.end });
    }
    protect.push(textSpans);

    // Uppercase view for GSTIN / IFSC / PAN (same offsets: ASCII-only change in these spans).
    const upper = () => masked.replace(/[a-z]/g, (c) => c.toUpperCase());
    const strong: Span[] = [];
    GSTIN_LOOSE.lastIndex = 0;
    for (const m of upper().matchAll(GSTIN_LOOSE)) {
      const f = fixGstin(m[1]);
      if (f) {
        gstins.push({ line: i, start: m.index, end: m.index + 15, value: f.value, fixed: f.fixed });
        strong.push({ start: m.index, end: m.index + 15 });
      }
    }
    IFSC_LOOSE.lastIndex = 0;
    for (const m of upper().matchAll(IFSC_LOOSE)) {
      if (strong.some((s) => m.index < s.end && s.start < m.index + 11)) continue;
      const f = fixIfsc(m[1]);
      if (f) {
        ifscs.push({ line: i, start: m.index, end: m.index + 11, value: f.value, fixed: f.fixed });
        strong.push({ start: m.index, end: m.index + 11 });
      }
    }
    for (const s of strong) masked = maskRange(masked, s.start, s.end);
    PAN_RE.lastIndex = 0;
    for (const m of upper().matchAll(PAN_RE)) masked = maskRange(masked, m.index, m.index + m[0].length);

    DATE_RE.lastIndex = 0;
    for (const m of masked.matchAll(DATE_RE)) {
      const raw = m[1];
      const iso = parseIndianDate(collapseSpaces(englishMonths(raw).replace(/[',]/g, " ")).replace(/\s*([-/.])\s*/g, "$1"));
      const y = iso ? Number(iso.slice(0, 4)) : 0;
      if (iso && y >= 2000 && y <= 2099) dates.push({ line: i, start: m.index, end: m.index + raw.length, value: raw, iso });
      masked = maskRange(masked, m.index, m.index + raw.length);
    }
    masked = masked.replace(PERCENT_RE, (s) => "#".repeat(s.length)).replace(TIME_RE, (s) => "#".repeat(s.length));

    // Amounts are recorded before digit runs; only "formatted" ones are masked
    // (₹ / Rs / commas / decimals) — bare integers stay visible as digit runs.
    AMOUNT_RE.lastIndex = 0;
    const amountMasks: Span[] = [];
    for (const m of masked.matchAll(AMOUNT_RE)) {
      const [whole, cur, int, dec, scale] = m;
      const clean = `${int}${dec ?? ""}${scale ? ` ${scale}` : ""}`;
      const paise = parseAmountToPaise(clean);
      if (paise === null || paise <= 0) continue;
      const formatted = !!cur || int.includes(",") || !!dec || !!scale || /\/-/.test(whole);
      const start = m.index + (whole.length - whole.trimStart().length);
      amounts.push({ line: i, start, end: m.index + whole.length, value: whole.trim(), paise, formatted });
      if (formatted) amountMasks.push({ start: m.index, end: m.index + whole.length });
    }
    for (const s of amountMasks) masked = maskRange(masked, s.start, s.end);

    RUN_RE.lastIndex = 0;
    for (const m of masked.matchAll(RUN_RE)) {
      const raw = m[0];
      const digits = raw.replace(/\D/g, "");
      runs.push({ line: i, start: m.index, raw, digits, groups: raw.replace(/^\+/, "").split(/[ -]/) });
    }
  });

  const { segments, labels } = segmentLines(lines, protect);
  return {
    lines,
    lineConf,
    ocr,
    source: ocr ? "ocr" : "text",
    segments,
    labelCats: labels.map((ls) => new Set(ls.map((l) => l.cat))),
    labelHits: labels,
    emails,
    upis,
    gstins,
    ifscs,
    banks,
    dates,
    amounts,
    runs,
  };
}

/** Label category of the segment containing (line, pos), or null. */
function labelAt(doc: Doc, line: number, pos: number): LabelCat | null {
  return segmentAt(doc, line, pos)?.label?.cat ?? null;
}
function segmentAt(doc: Doc, line: number, pos: number): Segment | undefined {
  return doc.segments.find((s) => s.line === line && pos >= s.offset && pos < s.offset + Math.max(1, s.text.length));
}

// ─────────────────────────── vendor fields ───────────────────────────

const NEUTRAL_FOR_NUMBERS = new Set<LabelCat | null>([
  null, "ifsc", "bank", "branch", "holder", "name", "business", "upi", "email", "address", "accType", "seller",
]);

function isPhoneShaped(digits: string, raw: string): boolean {
  if (isValidIndianMobile(digits) && digits.length <= 13) return true;
  if (/^1800\d{6,7}$/.test(digits)) return true; // toll-free
  if (/^0\d{2,4}[ -]\d{6,8}$/.test(raw.replace(/^\+/, "").trim())) return true; // landline with STD code
  return false;
}

/** Cheque MICR band: an unlabelled line with a 9-digit and a 6-digit group. */
function micrLines(doc: Doc): Set<number> {
  const out = new Set<number>();
  const byLine = new Map<number, string[]>();
  for (const r of doc.runs) byLine.set(r.line, [...(byLine.get(r.line) ?? []), ...r.groups]);
  for (const [line, groups] of byLine) {
    if (doc.labelCats[line].size) continue;
    if (groups.some((g) => g.length === 9) && groups.some((g) => g.length === 6)) out.add(line);
  }
  return out;
}

function accountNumber(doc: Doc): FieldResult<string> {
  const micr = micrLines(doc);
  const bankContext = doc.ifscs.length > 0 || doc.banks.length > 0;
  const cands: Cand<string>[] = [];
  for (const r of doc.runs) {
    const cat = labelAt(doc, r.line, r.start);
    const labelled = cat === "account";
    if (!labelled && !NEUTRAL_FOR_NUMBERS.has(cat)) continue;
    if (!labelled && micr.has(r.line)) continue;
    const pieces =
      r.digits.length >= 9 && r.digits.length <= 18 ? [r.digits] : r.digits.length > 18 ? r.groups.filter((g) => g.length >= 9 && g.length <= 18) : [];
    for (const digits of pieces) {
      const phone = isPhoneShaped(digits, pieces.length === 1 ? r.raw : digits);
      if (phone && !labelled) continue;
      if (r.raw.startsWith("+")) continue;
      let conf = labelled ? 0.93 : bankContext ? 0.75 : 0.7;
      const evidence = [labelled ? "keyword" : "no-keyword"];
      if (phone) {
        conf = 0.6;
        evidence.push("phone-shaped");
      }
      if (/^0+$/.test(digits) || /^(\d)\1+$/.test(digits)) continue;
      cands.push({
        value: digits,
        key: digits,
        conf: ocrAdjust(conf, doc.lineConf[r.line]),
        tier: labelled ? 0 : 1,
        evidence,
      });
    }
  }
  return decide(cands, doc.source, 0.08);
}

function phone(doc: Doc): FieldResult<string> {
  const cands: Cand<string>[] = [];
  const push = (digits: string, line: number, labelled: boolean) => {
    const p = normalizePhone(digits);
    if (!/^[6-9]\d{9}$/.test(p)) return;
    cands.push({
      value: p,
      key: p,
      conf: ocrAdjust(labelled ? 0.95 : 0.75, doc.lineConf[line]),
      tier: labelled ? 0 : 1,
      evidence: [labelled ? "keyword" : "no-keyword", "validated"],
    });
  };
  for (const r of doc.runs) {
    const cat = labelAt(doc, r.line, r.start);
    const labelled = cat === "phone" || cat === "upiApp";
    if (!labelled && (cat === "account" || !NEUTRAL_FOR_NUMBERS.has(cat))) continue;
    if (isValidIndianMobile(r.digits) && r.digits.length <= 12) {
      push(r.digits, r.line, labelled);
      continue;
    }
    // "98765 43210 91234 56789" — split into consecutive groups forming numbers.
    const g = r.groups;
    for (let a = 0; a < g.length; a++) {
      let acc = "";
      for (let b = a; b < g.length && acc.length < 12; b++) {
        acc += g[b];
        if (acc.length === 10 && /^[6-9]/.test(acc)) {
          push(acc, r.line, labelled);
          a = b;
          break;
        }
      }
    }
  }
  return decide(cands, doc.source, 0.1);
}

function email(doc: Doc): FieldResult<string> {
  const cands = doc.emails.map<Cand<string>>((e) => {
    const labelled = labelAt(doc, e.line, e.start) === "email";
    return {
      value: e.value,
      key: e.value,
      conf: ocrAdjust(labelled ? 0.96 : 0.92, doc.lineConf[e.line]),
      tier: labelled ? 0 : 1,
      evidence: [labelled ? "keyword" : "no-keyword", "validated"],
    };
  });
  return decide(cands, doc.source);
}

function upiId(doc: Doc): FieldResult<string> {
  const cands = doc.upis.map<Cand<string>>((u) => {
    const cat = labelAt(doc, u.line, u.start);
    const labelled = cat === "upi" || cat === "upiApp";
    const handle = u.value.split("@")[1];
    const known = UPI_HANDLES.has(handle);
    const conf = known ? (labelled ? 0.96 : 0.9) : labelled ? 0.82 : 0.6;
    return {
      value: u.value,
      key: u.value,
      conf: ocrAdjust(conf, doc.lineConf[u.line]),
      tier: labelled || known ? 0 : 1,
      evidence: [labelled ? "keyword" : "no-keyword", known ? "known-handle" : "unknown-handle"],
    };
  });
  return decide(cands, doc.source);
}

/** Tokens inside a labelled segment with spaces/dots removed ("HDFC 0001 234"). */
function compactScan(doc: Doc, cat: LabelCat, re: RegExp, len: number): { line: number; raw: string }[] {
  const out: { line: number; raw: string }[] = [];
  for (const s of doc.segments) {
    if (s.label?.cat !== cat) continue;
    const compact = s.text.toUpperCase().replace(/[\s.\-]/g, "");
    const r = new RegExp(re.source, "g");
    for (const m of compact.matchAll(r)) if (m[1].length === len) out.push({ line: s.line, raw: m[1] });
  }
  return out;
}

function gstinVendor(doc: Doc): FieldResult<string> {
  const cands: Cand<string>[] = [];
  for (const g of doc.gstins) {
    const labelled = labelAt(doc, g.line, g.start) === "gstin" || doc.labelCats[g.line].has("gstin");
    cands.push(gstinCand(doc, g.value, g.line, labelled ? 0 : 1, !!g.fixed));
  }
  for (const c of compactScan(doc, "gstin", /([0-9OISBZ]{2}[A-Z0-9]{5}[0-9OISBZG]{4}[A-Z0-9]{4})/, 15)) {
    const f = fixGstin(c.raw);
    if (f) cands.push(gstinCand(doc, f.value, c.line, 0, true));
  }
  return decide(cands, doc.source);
}

function gstinCand(doc: Doc, value: string, line: number, tier: number, fixed: boolean): Cand<string> {
  const base = fixed ? 0.86 : tier === 0 ? 0.97 : 0.93;
  return {
    value,
    key: value,
    conf: ocrAdjust(base, doc.lineConf[line], true),
    tier,
    evidence: ["checksum", tier === 0 ? "keyword" : "no-keyword", ...(fixed ? ["ocr-corrected"] : [])],
  };
}

function ifsc(doc: Doc): FieldResult<string> {
  const cands: Cand<string>[] = [];
  const add = (value: string, line: number, labelled: boolean, fixed: boolean) => {
    const known = !!bankFromIfsc(value);
    let conf = known ? (labelled ? 0.97 : 0.92) : labelled ? 0.8 : 0.6;
    if (fixed) conf = Math.min(conf, 0.8);
    cands.push({
      value,
      key: value,
      conf: ocrAdjust(conf, doc.lineConf[line], known && !fixed),
      tier: labelled ? 0 : 1,
      evidence: [labelled ? "keyword" : "no-keyword", known ? "known-bank-prefix" : "unknown-prefix", ...(fixed ? ["ocr-corrected"] : [])],
    });
  };
  for (const f of doc.ifscs) add(f.value, f.line, labelAt(doc, f.line, f.start) === "ifsc", !!f.fixed);
  for (const c of compactScan(doc, "ifsc", /([A-Z0-9]{4}[0O][A-Z0-9]{6})/, 11)) {
    const f = fixIfsc(c.raw);
    if (f) add(f.value, c.line, true, f.fixed);
  }
  return decide(cands, doc.source);
}

function bankName(doc: Doc, ifscResult: FieldResult<string>): FieldResult<string> {
  const labelled: Cand<string>[] = [];
  const unlabelled: Cand<string>[] = [];
  const inBankSegment = new Set<string>();
  for (const s of doc.segments) {
    if (s.label?.cat !== "bank") continue;
    const mentions = doc.banks.filter((b) => b.line === s.line && b.start >= s.offset && b.start < s.offset + s.text.length);
    mentions.forEach((m) => inBankSegment.add(`${m.line}:${m.start}`));
    if (mentions.length) {
      for (const m of mentions) {
        labelled.push({ value: m.value, key: m.value.toLowerCase(), conf: 0.9, tier: 0, evidence: ["keyword", "known-bank"] });
      }
    } else {
      const raw = cleanName(s.text);
      if (raw && /bank|बैंक/i.test(raw) && raw.length <= 50) {
        labelled.push({ value: raw, key: nameKey(raw), conf: 0.7, tier: 0, evidence: ["keyword", "unknown-bank"] });
      }
    }
  }
  for (const b of doc.banks) {
    if (inBankSegment.has(`${b.line}:${b.start}`)) continue;
    unlabelled.push({ value: b.value, key: b.value.toLowerCase(), conf: 0.8, tier: 1, evidence: ["known-bank"] });
  }
  const fromIfsc = ifscResult.value ? bankFromIfsc(ifscResult.value) : null;
  const adj = (c: Cand<string>[]) =>
    c.map((x) => {
      const line = doc.banks.find((b) => b.value === x.value)?.line;
      return { ...x, conf: ocrAdjust(x.conf, line === undefined ? undefined : doc.lineConf[line]) };
    });

  if (fromIfsc) {
    const text = labelled.length ? labelled : unlabelled;
    const keys = new Set(text.map((t) => t.key));
    if (!text.length) {
      return { value: fromIfsc, confidence: round(Math.min(ifscResult.confidence, 0.88)), candidates: [fromIfsc], source: doc.source, evidence: ["ifsc-prefix"] };
    }
    if (keys.has(fromIfsc.toLowerCase())) {
      const others = [...new Set(text.map((t) => t.value))].filter((v) => v !== fromIfsc);
      return {
        value: fromIfsc,
        confidence: others.length ? 0.85 : 0.97,
        candidates: [fromIfsc, ...others],
        source: doc.source,
        evidence: ["ifsc-prefix", "text-agrees"],
      };
    }
    if (!labelled.length) {
      // Unlabelled mention of another bank (e.g. in an address) — trust IFSC, but not confidently.
      return { value: fromIfsc, confidence: 0.7, candidates: [fromIfsc, ...new Set(text.map((t) => t.value))], source: doc.source, evidence: ["ifsc-prefix", "text-conflict"] };
    }
    return { value: null, confidence: 0, candidates: [fromIfsc, ...new Set(text.map((t) => t.value))], source: doc.source, evidence: ["ambiguous", "text-conflict"] };
  }
  return decide([...adj(labelled), ...adj(unlabelled)], doc.source);
}

const BUSINESS_SUFFIX =
  /\b(?:traders?|trading|enterprises?|agenc(?:y|ies)|distributors?|pharma(?:ceuticals?)?|medicals?|stores?|industries|& sons|and sons|pvt\.?\s*ltd\.?|private limited|limited|ltd\.?|llp|co\.|company|suppliers?|wholesalers?|mart|associates|corporation|solutions|textiles|foods|kirana|electricals?|hardware|chemists?)\b|ट्रेडर्स|एंटरप्राइजेज|फार्मा|स्टोर्स|मेडिकल|एजेंसी|डिस्ट्रीब्यूटर्स/iu;
const SIGNATORY = /authori[sz]ed\s+signator|signatory|proprietor|partner|director|प्राधिकृत|हस्ताक्षर/iu;

/** "For SUNRISE PHARMA (DEMO)" above "Authorised Signatory". */
function signatureNames(doc: Doc): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  doc.lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:for|कृते)\s*[:\-]?\s+(.{3,70})$/iu);
    if (!m) return;
    const near = doc.lines.slice(Math.max(0, i - 2), i + 4).some((x) => SIGNATORY.test(x));
    if (!near) return;
    const name = cleanName(m[1]);
    if (name) out.push({ name, line: i });
  });
  return out;
}

function accountHolderName(doc: Doc): FieldResult<string> {
  const cands: Cand<string>[] = [];
  const tierOf: Partial<Record<LabelCat, [number, number]>> = {
    holder: [0, 0.92],
    name: [1, 0.86],
    business: [2, 0.7],
    seller: [2, 0.65],
  };
  for (const s of doc.segments) {
    const t = s.label && tierOf[s.label.cat];
    if (!t) continue;
    const name = cleanName(s.text);
    if (!name) continue;
    if (doc.banks.some((b) => b.line === s.line && b.start >= s.offset && b.end <= s.offset + s.text.length && nameKey(b.value) === nameKey(name))) continue;
    cands.push({ value: name, key: nameKey(name), conf: ocrAdjust(t[1], doc.lineConf[s.line]), tier: t[0], evidence: ["keyword"] });
  }
  for (const sig of signatureNames(doc)) {
    cands.push({ value: sig.name, key: nameKey(sig.name), conf: ocrAdjust(0.6, doc.lineConf[sig.line]), tier: 3, evidence: ["signature-block"] });
  }
  if (!cands.length) {
    // A first line that looks like a business name ("Sunrise Pharma Distributors").
    const idx = doc.lines.findIndex((l) => l.trim());
    if (idx >= 0 && !doc.labelCats[idx].size && BUSINESS_SUFFIX.test(doc.lines[idx])) {
      const name = cleanName(doc.lines[idx]);
      if (name) cands.push({ value: name, key: nameKey(name), conf: ocrAdjust(0.5, doc.lineConf[idx]), tier: 4, evidence: ["first-line"] });
    }
  }
  // Same name under several tiers is agreement, not ambiguity.
  return decide(cands, doc.source, 0.04);
}

export function parseVendorText(text: string, opts: ParseOptions = {}): VendorExtraction {
  const doc = analyze(text, opts);
  const ifscRes = ifsc(doc);
  return {
    accountHolderName: capOcrName(accountHolderName(doc), doc),
    accountNumber: accountNumber(doc),
    ifsc: ifscRes,
    bankName: bankName(doc, ifscRes),
    upiId: upiId(doc),
    gstin: gstinVendor(doc),
    phone: phone(doc),
    email: email(doc),
  };
}

// ─────────────────────────── invoice fields ───────────────────────────

const TITLE_LINE =
  /^\s*(?:(?:gst\s*)?tax\s*invoice|invoice|bill\s*of\s*supply|retail\s*invoice|gst\s*invoice|cash\s*memo|credit\s*memo|estimate|proforma(?:\s*invoice)?|quotation|bill|original(?:\s*for\s*(?:recipient|buyer))?|duplicate(?:\s*for\s*(?:transporter|supplier))?|triplicate|कर\s*बीजक|बीजक|टैक्स\s*इनवॉइस|बिल|चालान)(?![\p{L}\p{M}])[\s\-()a-z]*$/iu;
const ADDRESS_HINT =
  /\b(?:road|rd\.?|nagar|marg|street|st\.|lane|floor|shop\s*no|plot|sector|near|opp\.?|behind|building|bldg|complex|market|bazar|bazaar|chowk|gali|colony|society|apartment|phase|industrial|estate|mumbai|delhi|pune|bengaluru|bangalore|chennai|kolkata|hyderabad|ahmedabad|jaipur|lucknow|india|maharashtra|gujarat|karnataka)\b|मार्ग|नगर|रोड|बाज़ार|बाजार|गली/iu;
const TABLE_HEADER = /(?:description|particulars|item|hsn|qty|quantity|rate|s\.?\s*no|sr\.?\s*no|विवरण|मात्रा|दर)/iu;

type Zone = "seller" | "buyer" | "other";

/** seller zone = header until the first buyer label; buyer zone ≤ 6 lines after a buyer label. */
function zones(doc: Doc): Zone[] {
  const z: Zone[] = [];
  let current: Zone = "seller";
  let buyerLeft = 0;
  doc.lines.forEach((line, i) => {
    const cats = doc.labelCats[i];
    const tableHeader = (line.match(new RegExp(TABLE_HEADER.source, "giu")) ?? []).length >= 2;
    if (cats.has("buyer")) {
      current = "buyer";
      buyerLeft = 6;
    } else if (cats.has("seller")) {
      current = "seller";
    } else if (tableHeader) {
      current = "other";
    } else if (current === "buyer") {
      buyerLeft--;
      if (buyerLeft <= 0 || !line.trim()) current = "other";
    }
    z.push(current);
  });
  return z;
}

function vendorGstinInvoice(doc: Doc, z: Zone[], own: string | null): FieldResult<string> {
  const cands: Cand<string>[] = [];
  const seen: { line: number; start: number; value: string; fixed: boolean }[] = doc.gstins.map((g) => ({ line: g.line, start: g.start, value: g.value, fixed: !!g.fixed }));
  for (const c of compactScan(doc, "gstin", /([0-9OISBZ]{2}[A-Z0-9]{5}[0-9OISBZG]{4}[A-Z0-9]{4})/, 15)) {
    const f = fixGstin(c.raw);
    if (f && !seen.some((s) => s.value === f.value)) seen.push({ line: c.line, start: 0, value: f.value, fixed: true });
  }
  // "Supplier GSTIN: A   Recipient GSTIN: B" — the nearest seller/buyer label to the left wins.
  const zoneOf = (g: { line: number; start: number }): Zone => {
    const side = doc.labelHits[g.line].filter((h) => (h.cat === "seller" || h.cat === "buyer") && h.end <= g.start).pop();
    return side ? (side.cat as Zone) : z[g.line];
  };
  const buyerValues = new Set<string>();
  for (const g of seen) if (zoneOf(g) === "buyer") buyerValues.add(g.value);
  for (const g of seen) {
    if (own && g.value === own) continue;
    if (buyerValues.has(g.value)) continue;
    const zone = zoneOf(g);
    const tier = zone === "seller" ? 0 : 1;
    const c = gstinCand(doc, g.value, g.line, tier, g.fixed);
    if (tier === 1) c.conf = Math.min(c.conf, 0.75);
    c.evidence.push(zone === "seller" ? "seller-zone" : "zone-unknown");
    cands.push(c);
  }
  const res = decide(cands, doc.source, 0.1);
  if (!res.value && !res.candidates.length && buyerValues.size && !own) {
    // Only buyer GSTINs found: offer them as choices, never as a value.
    return { ...res, candidates: [...buyerValues], evidence: ["buyer-only"] };
  }
  return res;
}

function invoiceNumber(doc: Doc): FieldResult<string> {
  const cands: Cand<string>[] = [];
  for (const s of doc.segments) {
    const cat = s.label?.cat;
    if (cat !== "invoiceNo" && cat !== "invoiceNoDate") continue;
    const text = s.text.replace(/^(?:no|number|#)\b\.?\s*[:\-]?\s*/iu, "");
    const dateSpans: Span[] = [];
    DATE_RE.lastIndex = 0;
    for (const m of text.matchAll(DATE_RE)) dateSpans.push({ start: m.index, end: m.index + m[1].length });
    const tokRe = /[A-Za-z0-9][A-Za-z0-9\-/._#]*[A-Za-z0-9]|[0-9]/g;
    for (const m of text.matchAll(tokRe)) {
      if (dateSpans.some((d) => m.index < d.end && d.start < m.index + m[0].length)) continue;
      const tok = m[0];
      if (!/\d/.test(tok) || tok.length > 24) continue;
      if (/^(?:dt|dated|date)$/i.test(tok)) continue;
      // OCR confuses I/l/1 and O/0: a mixed-case token or a letter wedged in
      // digits is unverifiable, so never confident.
      const suspicious = doc.ocr && ((/[a-z]/.test(tok) && /[A-Z]/.test(tok)) || /\d[OIlo|]|[OIlo|]\d/.test(tok));
      cands.push({
        value: tok,
        key: tok.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        conf: suspicious ? Math.min(0.7, ocrAdjust(0.92, doc.lineConf[s.line])) : ocrAdjust(0.92, doc.lineConf[s.line]),
        tier: 0,
        evidence: suspicious ? ["keyword", "ocr-confusable"] : ["keyword"],
      });
      break; // first token after the label
    }
  }
  return decide(cands, doc.source);
}

function invoiceDates(doc: Doc): { invoiceDate: FieldResult<string>; dueDate: FieldResult<string> } {
  const inv: Cand<string>[] = [];
  const due: Cand<string>[] = [];
  for (const d of doc.dates) {
    const seg = segmentAt(doc, d.line, d.start);
    const cat = seg?.label?.cat ?? null;
    const lc = doc.lineConf[d.line];
    const mk = (tier: number, conf: number, ev: string): Cand<string> => ({ value: d.iso, key: d.iso, conf: ocrAdjust(conf, lc), tier, evidence: [ev] });
    if (cat === "dueDate") due.push(mk(0, 0.92, "keyword"));
    else if (cat === "invoiceDate" || cat === "invoiceNoDate") inv.push(mk(0, 0.93, "keyword"));
    else if (cat === "date") inv.push(mk(1, 0.88, "keyword-generic"));
    else if (cat === null || NEUTRAL_FOR_NUMBERS.has(cat) || cat === "invoiceNo") inv.push(mk(2, 0.6, "no-keyword"));
  }
  const invoiceDate = decide(inv, doc.source, 0.05);
  const dueDate = decide(due, doc.source, 0.05);
  if (invoiceDate.value && dueDate.value && dueDate.value < invoiceDate.value) {
    // Inconsistent: never confident about either.
    invoiceDate.confidence = Math.min(invoiceDate.confidence, 0.5);
    dueDate.confidence = Math.min(dueDate.confidence, 0.5);
    dueDate.evidence = [...(dueDate.evidence ?? []), "before-invoice-date"];
  }
  // A due date must not double as the invoice date.
  if (invoiceDate.value && invoiceDate.value === dueDate.value && (invoiceDate.evidence ?? []).includes("no-keyword")) {
    return { invoiceDate: { ...emptyField<string>(doc.source), candidates: [invoiceDate.value] }, dueDate };
  }
  return { invoiceDate, dueDate };
}

function rightmostAmount(list: AmountFound[]): AmountFound | undefined {
  const formatted = list.filter((a) => a.formatted);
  const pool = formatted.length ? formatted : list;
  return pool.sort((a, b) => b.start - a.start)[0];
}

function amountsBySegment(doc: Doc, cats: LabelCat[]): { amount: AmountFound; cat: LabelCat }[] {
  const out: { amount: AmountFound; cat: LabelCat }[] = [];
  for (const s of doc.segments) {
    if (!s.label || !cats.includes(s.label.cat)) continue;
    const inSeg = doc.amounts.filter((a) => a.line === s.line && a.start >= s.offset && a.start < s.offset + s.text.length);
    const a = rightmostAmount(inSeg);
    if (a) out.push({ amount: a, cat: s.label.cat });
  }
  return out;
}

function totalPaise(doc: Doc): FieldResult<number> {
  const totals = amountsBySegment(doc, ["total1", "total2", "total3"]);
  const tierOf: Record<string, number> = { total1: 0, total2: 1, total3: 2 };
  const confOf: Record<string, number> = { total1: 0.9, total2: 0.85, total3: 0.72 };

  // Corroboration sources.
  const words = doc.lines.map((l) => amountWordsToPaise(l)).filter((x): x is number => x !== null);
  const sub = amountsBySegment(doc, ["subtotal"]).map((x) => x.amount.paise);
  const taxRows = amountsBySegment(doc, ["tax"]);
  const round_ = amountsBySegment(doc, ["roundOff"]).map((x) => {
    const before = doc.lines[x.amount.line].slice(0, x.amount.start);
    return /\(-\)\s*$|-\s*(?:₹|rs\.?)?\s*$/i.test(before) ? -x.amount.paise : x.amount.paise;
  });
  const totalTaxRow = taxRows.find((t) => /total\s*(?:tax|gst)|tax\s*amount|gst\s*amount/i.test(doc.lines[t.amount.line]));
  const taxSum = totalTaxRow ? totalTaxRow.amount.paise : taxRows.reduce((s, t) => s + t.amount.paise, 0);
  const sums = sub.map((s) => s + taxSum + round_.reduce((a, b) => a + b, 0));

  const counts = new Map<number, number>();
  for (const t of totals) counts.set(t.amount.paise, (counts.get(t.amount.paise) ?? 0) + 1);

  const cands: Cand<number>[] = totals.map(({ amount: a, cat }) => {
    const ev = ["keyword"];
    let amount = a;
    let corroborated = false;
    // OCR often reads "₹" as a leading digit ("₹2,36,000" → "72,36,000"). If the
    // amount-in-words / subtotal+tax agree on the same number minus that leading
    // digit, take the corroborated number.
    if (doc.ocr) {
      const fix = [...words, ...(taxSum > 0 ? sums : [])].find(
        (w) => w !== amount.paise && String(amount.paise).length === String(w).length + 1 && String(amount.paise).endsWith(String(w)),
      );
      if (fix !== undefined) {
        amount = { ...amount, paise: fix };
        ev.push("rupee-sign-misread");
      }
    }
    if (words.includes(amount.paise)) {
      ev.push("matches-words");
      corroborated = true;
    }
    if (taxSum > 0 && sums.some((s) => Math.abs(s - amount.paise) <= 100)) {
      ev.push("matches-subtotal+tax");
      corroborated = true;
    }
    if ((counts.get(amount.paise) ?? 0) > 1) {
      ev.push("repeated");
      corroborated = true;
    }
    let conf = confOf[cat] + (corroborated ? 0.07 : 0);
    const lc = doc.lineConf[amount.line];
    conf = ocrAdjust(conf, lc);
    // OCR digits are unverifiable on their own: confident only if corroborated.
    if (doc.ocr && !corroborated) conf = Math.min(conf, 0.75);
    return { value: amount.paise, key: String(amount.paise), conf, tier: tierOf[cat], evidence: ev };
  });

  // The largest total-labelled amount wins within a tier if all others are
  // components of it (e.g. "Total 10,000" in the item table, "Grand Total 11,800").
  const res = decide(cands, doc.source, 0.05);
  if (res.value === null && cands.length) {
    const bestTier = Math.min(...cands.map((c) => c.tier));
    const tierC = cands.filter((c) => c.tier === bestTier);
    const corroborated = tierC.filter((c) => c.evidence.some((e) => e.startsWith("matches")));
    const uniqCorr = [...new Set(corroborated.map((c) => c.value))];
    if (uniqCorr.length === 1) {
      const w = corroborated.find((c) => c.value === uniqCorr[0])!;
      return { value: w.value, confidence: round(Math.min(w.conf, 0.85) - 0.05), candidates: res.candidates, source: doc.source, evidence: [...w.evidence, "alternatives"] };
    }
  }
  if (res.value === null && !cands.length && words.length === 1) {
    return { value: words[0], confidence: 0.6, candidates: [words[0]], source: doc.source, evidence: ["words-only"] };
  }
  return res;
}

function creditDays(doc: Doc): FieldResult<number> {
  const cands: Cand<number>[] = [];
  const re =
    /(?:credit(?:\s*(?:period|days|terms))?|net|payment\s*terms?|terms|within|due\s*in|payable\s*in|उधार|क्रेडिट)\s*[:\-]?\s*(\d{1,3})\s*(?:days?|दिन)|(\d{1,3})\s*(?:days?|दिन)\s*(?:credit|उधार|क्रेडिट)/giu;
  doc.lines.forEach((l, i) => {
    for (const m of l.matchAll(re)) {
      const n = Number(m[1] ?? m[2]);
      if (n > 0 && n <= 365) cands.push({ value: n, key: String(n), conf: ocrAdjust(0.88, doc.lineConf[i]), tier: 0, evidence: ["keyword"] });
    }
  });
  return decide(cands, doc.source);
}

function vendorNameInvoice(doc: Doc, z: Zone[]): FieldResult<string> {
  const cands: Cand<string>[] = [];
  for (const s of doc.segments) {
    if (s.label?.cat !== "seller" && s.label?.cat !== "business") continue;
    if (z[s.line] === "buyer") continue;
    const name = cleanName(s.text);
    if (name) cands.push({ value: name, key: nameKey(name), conf: ocrAdjust(0.86, doc.lineConf[s.line]), tier: 0, evidence: ["keyword"] });
  }
  // Header: first plausible line of the seller zone.
  let header: { name: string; line: number } | null = null;
  for (let i = 0; i < Math.min(doc.lines.length, 8); i++) {
    if (z[i] !== "seller") break;
    const l = doc.lines[i].trim();
    if (!l || TITLE_LINE.test(l)) continue;
    if (doc.labelCats[i].size) {
      if (doc.labelCats[i].has("seller")) continue;
      break;
    }
    if ((l.match(/\d/g) ?? []).length >= 4 || ADDRESS_HINT.test(l) || /\b\d{6}\b/.test(l)) continue;
    const name = cleanName(l);
    if (name) {
      header = { name, line: i };
      break;
    }
  }
  const sigs = signatureNames(doc);
  if (header) {
    const agrees = sigs.some((s) => nameKey(s.name) === nameKey(header!.name) || nameMatchScore(s.name, header!.name) >= 0.8);
    cands.push({
      value: header.name,
      key: nameKey(header.name),
      conf: ocrAdjust(agrees ? 0.88 : 0.62, doc.lineConf[header.line]),
      tier: agrees ? 0 : 1,
      evidence: agrees ? ["header", "matches-signature"] : ["header"],
    });
    if (agrees) {
      return decide(cands.filter((c) => c.tier === 0), doc.source);
    }
  }
  for (const s of sigs) {
    cands.push({ value: s.name, key: nameKey(s.name), conf: ocrAdjust(0.6, doc.lineConf[s.line]), tier: 1, evidence: ["signature-block"] });
  }
  return decide(cands, doc.source, 0.05);
}

export function parseInvoiceText(text: string, opts: InvoiceParseOptions = {}): InvoiceExtraction {
  const doc = analyze(text, opts);
  const z = zones(doc);
  const own = opts.ownGstin ? opts.ownGstin.replace(/\s+/g, "").toUpperCase() : null;
  const { invoiceDate, dueDate } = invoiceDates(doc);
  return {
    vendorGstin: vendorGstinInvoice(doc, z, own),
    vendorName: capOcrName(vendorNameInvoice(doc, z), doc),
    invoiceNumber: invoiceNumber(doc),
    invoiceDate,
    dueDate,
    totalPaise: totalPaise(doc),
    creditDays: creditDays(doc),
  };
}
