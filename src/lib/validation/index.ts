/**
 * Pure validators for Indian banking identifiers. Shared by the UI, server
 * actions (via Zod schemas), the on-device parser and the bank-file generator.
 */

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{9,18}$/;
export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeIfsc(v: string): string {
  return v.replace(/\s+/g, "").toUpperCase();
}
export function isValidIfsc(v: string): boolean {
  return IFSC_RE.test(normalizeIfsc(v));
}

export function normalizeAccount(v: string): string {
  return v.replace(/[\s-]/g, "");
}
export function isValidAccountNumber(v: string): boolean {
  return ACCOUNT_RE.test(normalizeAccount(v));
}

export function normalizeUpi(v: string): string {
  return v.trim().toLowerCase();
}
export function isValidUpi(v: string): boolean {
  return UPI_RE.test(v.trim());
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Computes the GSTIN check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CHARS.indexOf(first14[i]);
    if (code < 0) return "";
    const factor = i % 2 === 0 ? 1 : 2;
    const product = code * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return GSTIN_CHARS[check];
}

export function normalizeGstin(v: string): string {
  return v.replace(/\s+/g, "").toUpperCase();
}

export function isValidGstin(v: string): boolean {
  const g = normalizeGstin(v);
  if (!GSTIN_RE.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (state < 1 || (state > 38 && state !== 97 && state !== 99)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

export function normalizePhone(v: string): string {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}
export function isValidIndianMobile(v: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizePhone(v));
}

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function last4(account: string): string {
  return normalizeAccount(account).slice(-4);
}

export function maskAccount(last4Digits: string | null | undefined): string {
  return last4Digits ? `••••${last4Digits}` : "—";
}

const NAME_STOPWORDS = new Set([
  "m/s", "ms", "mr", "mrs", "shri", "smt", "the", "and", "&", "pvt", "private",
  "ltd", "limited", "llp", "co", "company", "enterprises", "enterprise", "traders",
  "trading", "agency", "agencies", "and", "sons", "inc", "corp", "corporation",
  "store", "stores", "medical", "medicals", "pharma", "distributors", "distributor",
]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s/&]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

/**
 * Rough similarity (0..1) between an account holder name and a vendor name.
 * Token overlap with prefix matching, so "R K Pharma" ~ "Rajesh Kumar".
 */
export function nameMatchScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const compactA = ta.join("");
  const compactB = tb.join("");
  if (compactA === compactB) return 1;
  let hits = 0;
  for (const t of ta) {
    if (tb.some((u) => u === t || (t.length >= 3 && (u.startsWith(t) || t.startsWith(u))))) hits++;
  }
  const initialsA = ta.map((t) => t[0]).join("");
  const initialsB = tb.map((t) => t[0]).join("");
  const initialBonus = initialsA === initialsB ? 0.3 : 0;
  return Math.min(1, hits / Math.max(ta.length, tb.length) + initialBonus);
}

export function namesReasonablyMatch(a: string, b: string): boolean {
  return nameMatchScore(a, b) >= 0.5;
}
