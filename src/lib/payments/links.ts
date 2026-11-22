import { paiseToDecimalString } from "../money";
import { isValidIndianMobile, isValidUpi, normalizePhone, normalizeUpi } from "../validation";

/** encodeURIComponent, but keeps "@" readable (some UPI apps reject %40 in `pa`). */
function enc(v: string): string {
  return encodeURIComponent(v).replace(/%40/g, "@");
}

/**
 * UPI intent link: `upi://pay?pa=…&pn=…&am=123.45&cu=INR&tn=…`.
 * `amountPaise` is optional (payer enters it) but must be a positive integer when given.
 * `pn` is trimmed to 50 chars, `tn` to 80. Throws on an invalid VPA.
 */
export function upiDeepLink(opts: { pa: string; pn: string; amountPaise?: number | null; tn?: string | null; tr?: string | null }): string {
  const pa = normalizeUpi(opts.pa);
  if (!isValidUpi(pa)) throw new RangeError("upiDeepLink: invalid UPI ID");
  const parts = [`pa=${enc(pa)}`, `pn=${enc(opts.pn.trim().slice(0, 50))}`];
  if (opts.amountPaise != null) {
    if (!Number.isSafeInteger(opts.amountPaise) || opts.amountPaise <= 0) {
      throw new RangeError("upiDeepLink: amountPaise must be a positive integer");
    }
    parts.push(`am=${paiseToDecimalString(opts.amountPaise, 2)}`);
  }
  parts.push("cu=INR");
  const tn = opts.tn?.trim();
  if (tn) parts.push(`tn=${enc(tn.slice(0, 80))}`);
  const tr = opts.tr?.trim();
  if (tr) parts.push(`tr=${enc(tr.slice(0, 35))}`);
  return `upi://pay?${parts.join("&")}`;
}

/** `https://wa.me/91XXXXXXXXXX?text=…`; without a valid Indian mobile → `https://wa.me/?text=…`. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const p = phone ? normalizePhone(phone) : "";
  const target = p && isValidIndianMobile(p) ? `91${p}` : "";
  return `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
}

/** Deterministic idempotency key for direct-pay requests: retries of the same run payment never pay twice. */
export function directPayIdempotencyKey(runPaymentId: string): string {
  return `tarrow-${runPaymentId}`;
}

/**
 * Short payment reference for narrations/direct-pay, ≤ `maxLength` (40) chars of [A-Z0-9-]:
 * `TA-{RUNSHORTID}-{first 8 alphanumerics of the payment id}`. Deterministic, so
 * reconcileStatusRows() can match it back.
 */
export function paymentReference(runShortId: string, runPaymentId: string, maxLength = 40): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ref = `TA-${clean(runShortId)}-${clean(runPaymentId).slice(0, 8)}`;
  return ref.slice(0, maxLength).replace(/-+$/, "");
}
