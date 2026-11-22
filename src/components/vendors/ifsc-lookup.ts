"use client";
import { isValidIfsc, normalizeIfsc } from "@/lib/validation";

export type IfscInfo = { bank: string; branch: string; city?: string };
const cache = new Map<string, IfscInfo | null>();

/** Free public lookup (only the IFSC code is sent). Returns null when not found. */
export async function lookupIfsc(code: string, signal?: AbortSignal): Promise<IfscInfo | null | "error"> {
  const ifsc = normalizeIfsc(code);
  if (!isValidIfsc(ifsc)) return null;
  if (cache.has(ifsc)) return cache.get(ifsc)!;
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`, { signal });
    if (res.status === 404) {
      cache.set(ifsc, null);
      return null;
    }
    if (!res.ok) return "error";
    const j = (await res.json()) as { BANK?: string; BRANCH?: string; CITY?: string };
    const info = { bank: j.BANK ?? "", branch: j.BRANCH ?? "", city: j.CITY };
    cache.set(ifsc, info);
    return info;
  } catch {
    return "error";
  }
}
