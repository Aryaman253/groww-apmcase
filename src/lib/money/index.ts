/**
 * Money is handled as integer paise everywhere (DB: bigint). Never floats.
 */

export type Paise = number;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const plain = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,23,456.00 */
export function formatInr(paise: Paise): string {
  return inr.format(paise / 100);
}
/** ₹1,23,456 (rounded, for hero numbers) */
export function formatInrRounded(paise: Paise): string {
  return inrCompact.format(Math.round(paise / 100));
}
/** 1,23,456.00 */
export function formatAmountPlain(paise: Paise): string {
  return plain.format(paise / 100);
}
/** 123456.00 — for bank files, no grouping. */
export function paiseToDecimalString(paise: Paise, decimals = 2): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const s = decimals === 0 ? String(Math.round(abs / 100)) : `${rupees}.${String(p).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/**
 * Parses "1,23,456.50", "₹ 1.5 lakh", "Rs.12000/-", "12,000" into paise.
 * Returns null when not a clean amount.
 */
export function parseAmountToPaise(input: string | number | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.toString().trim().toLowerCase();
  if (!s) return null;
  let multiplier = 1;
  if (/(lakh|lac|लाख)/.test(s)) multiplier = 100000;
  else if (/(crore|\bcr\b|करोड़)/.test(s)) multiplier = 10000000;
  s = s
    .replace(/₹|rs\.?|inr|\/-|lakhs?|lacs?|crores?|\bcr\b|लाख|करोड़/g, "")
    .replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, frac = ""] = s.split(".");
  if (multiplier === 1) {
    const paise = Number(intPart) * 100 + Number((frac + "00").slice(0, 2));
    return intPart.startsWith("-") ? -Math.abs(paise) : paise;
  }
  return Math.round(Number(s) * multiplier * 100);
}

export function sumPaise(values: Paise[]): Paise {
  return values.reduce((a, b) => a + b, 0);
}
