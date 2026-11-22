import { isValidGstin, nameMatchScore, normalizeGstin } from "../validation";

export interface MatchableVendor {
  id: string;
  name: string;
  gstin?: string | null;
}

export type VendorMatchKind = "gstin" | "exact";

export interface VendorMatchResult<V> {
  /** Only set for GSTIN or exact normalised-name matches. Fuzzy matches are never auto-assigned. */
  match: V | null;
  kind: VendorMatchKind | null;
  /** Fuzzy suggestions (best first) when there is no match. */
  suggestions: { vendor: V; score: number }[];
}

const LEGAL_TOKENS = new Set(["ms", "m/s", "the", "pvt", "private", "ltd", "limited", "llp", "inc"]);

/** "M/s. Sunrise Pharma Distributors Pvt. Ltd." → "sunrise pharma distributors". */
export function normalizeVendorName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bm\/s\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !LEGAL_TOKENS.has(t))
    .join(" ");
}

function bigrams(s: string): Map<string, number> {
  const c = s.replace(/\s+/g, " ");
  const m = new Map<string, number>();
  for (let i = 0; i < c.length - 1; i++) {
    const g = c.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

/** 0..1 similarity used for suggestions: token overlap (nameMatchScore) blended with character bigrams. */
export function vendorNameSimilarity(a: string, b: string): number {
  const na = normalizeVendorName(a);
  const nb = normalizeVendorName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.round((0.5 * nameMatchScore(na, nb) + 0.5 * dice(na, nb)) * 1000) / 1000;
}

/**
 * Matches an imported/parsed party to an existing vendor:
 * 1. GSTIN (exact, normalised) → kind "gstin".
 * 2. Exact normalised name → kind "exact" (skipped when both sides have different GSTINs).
 * 3. Otherwise up to `limit` (3) fuzzy suggestions with score ≥ `threshold` (0.5). Never auto-assigned.
 */
export function matchVendor<V extends MatchableVendor>(
  input: { gstin?: string | null; name?: string | null },
  vendors: V[],
  opts: { threshold?: number; limit?: number } = {},
): VendorMatchResult<V> {
  const gstin = input.gstin ? normalizeGstin(input.gstin) : "";
  if (gstin && isValidGstin(gstin)) {
    const g = vendors.find((v) => v.gstin && normalizeGstin(v.gstin) === gstin);
    if (g) return { match: g, kind: "gstin", suggestions: [] };
  }
  const name = normalizeVendorName(input.name);
  if (!name) return { match: null, kind: null, suggestions: [] };

  const exact = vendors.find((v) => {
    if (normalizeVendorName(v.name) !== name) return false;
    const vg = v.gstin ? normalizeGstin(v.gstin) : "";
    return !(gstin && vg && vg !== gstin);
  });
  if (exact) return { match: exact, kind: "exact", suggestions: [] };

  const threshold = opts.threshold ?? 0.5;
  const suggestions = vendors
    .map((vendor) => ({ vendor, score: vendorNameSimilarity(name, vendor.name) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.vendor.name.localeCompare(b.vendor.name))
    .slice(0, opts.limit ?? 3);
  return { match: null, kind: null, suggestions };
}
