import { normalizeAccount } from "../validation";

export type NormalizedStatus = "success" | "failed" | "pending";

export interface NormalizedStatusResult {
  status: NormalizedStatus;
  /** false when the text matched no known word (status defaults to "pending"). */
  recognized: boolean;
  /** Failure reason extracted from the text, e.g. "Rejected - Invalid account" → "Invalid account". */
  reason: string | null;
}

// Order matters: failure words first ("Not processed", "Unsuccessful" contain success words).
const FAILED_RE =
  /\b(fail(ed|ure)?|reject(ed)?|return(ed)?|revers(ed|al)|cancel+(ed)?|declined?|unsuccessful|not\s+(processed|paid|credited|executed)|bounced?|error|invalid|expired|insufficient)\b/i;
const PENDING_RE =
  /\b(pending|in[\s-]?process|in[\s-]?progress|processing|under\s+process|initiated|submitted|awaiting|queued|scheduled|on\s+hold|hold|authori[sz](ed|ation)|approved|accepted|received|sent\s+to\s+bank)\b/i;
const SUCCESS_RE =
  /\b(success(ful(ly)?)?|paid|processed|completed?|executed|credited|settled|done|transferred|ok)\b/i;

/** Normalises a bank status/report text into success | failed | pending, with failure reason. */
export function normalizeStatusText(text: string | null | undefined, reasonField?: string | null): NormalizedStatusResult {
  const s = (text ?? "").trim();
  const extraReason = reasonField?.trim() || null;
  if (FAILED_RE.test(s)) {
    // "Rejected - Invalid account" / "Failed: Account closed" / "Returned (Account closed)"
    const m = s.match(/^(.*?)\s*(?:\s-\s|[:–(])\s*(.+?)\)?$/);
    const fromText = m && FAILED_RE.test(m[1]) ? m[2].trim() : null;
    return { status: "failed", recognized: true, reason: extraReason ?? fromText ?? (s || null) };
  }
  if (PENDING_RE.test(s)) return { status: "pending", recognized: true, reason: null };
  if (SUCCESS_RE.test(s)) return { status: "success", recognized: true, reason: null };
  return { status: "pending", recognized: false, reason: null };
}

export interface StatusRow {
  accountNumber?: string | null;
  amountPaise?: number | null;
  /** Our reference / narration / customer reference as echoed by the bank. */
  reference?: string | null;
  utr?: string | null;
  status?: string | null;
  reason?: string | null;
}

export interface ReconcilablePayment {
  id: string;
  /** Short reference written into the file/narration (see paymentReference()). */
  reference?: string | null;
  accountNumber?: string | null;
  /** When only the last 4 digits are stored. */
  accountLast4?: string | null;
  amountPaise: number;
}

export interface ReconciledMatch {
  rowIndex: number;
  row: StatusRow;
  paymentId: string;
  by: "reference" | "account_amount";
  status: NormalizedStatus;
  recognized: boolean;
  reason: string | null;
  utr: string | null;
}

export interface ReconcileResult {
  matched: ReconciledMatch[];
  unmatched: { rowIndex: number; row: StatusRow }[];
  ambiguous: { rowIndex: number; row: StatusRow; candidatePaymentIds: string[] }[];
  /** Payments that no row matched. */
  missingPaymentIds: string[];
}

const compact = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function referenceMatches(rowRef: string, p: ReconcilablePayment): boolean {
  const id = compact(p.id);
  const ref = compact(p.reference);
  if (!rowRef) return false;
  if (rowRef === id || (ref && rowRef === ref)) return true;
  // Reference embedded in a longer narration.
  return (ref.length >= 8 && rowRef.includes(ref)) || (id.length >= 12 && rowRef.includes(id));
}

/** 2 = full account number equal, 1 = last-4 equal (masked row or only last 4 known), 0 = no match. */
function accountMatchStrength(rowAcct: string, p: ReconcilablePayment): 0 | 1 | 2 {
  const digits = rowAcct.replace(/\D/g, "");
  if (digits.length < 4) return 0;
  const full = p.accountNumber ? normalizeAccount(p.accountNumber) : "";
  const l4 = p.accountLast4 ?? (full ? full.slice(-4) : "");
  const masked = /[x*•]/i.test(rowAcct) || digits.length < 9;
  if (!masked && full) return digits === full ? 2 : 0;
  return l4 && digits.slice(-4) === l4 ? 1 : 0;
}

/**
 * Matches status/report rows to run payments: by reference (payment id or short
 * reference) first, otherwise by account number (full or last 4) + exact amount.
 * Full account matches outrank last-4 matches; account+amount matches prefer
 * payments not already matched by another row; if
 * more than one candidate remains the row is ambiguous (never guessed).
 */
export function reconcileStatusRows(rows: StatusRow[], payments: ReconcilablePayment[]): ReconcileResult {
  const result: ReconcileResult = { matched: [], unmatched: [], ambiguous: [], missingPaymentIds: [] };
  const claimed = new Set<string>();
  const pending: number[] = [];

  const push = (rowIndex: number, p: ReconcilablePayment, by: ReconciledMatch["by"]) => {
    const row = rows[rowIndex];
    const n = normalizeStatusText(row.status, row.reason);
    claimed.add(p.id);
    result.matched.push({ rowIndex, row, paymentId: p.id, by, ...n, utr: row.utr?.trim() || null });
  };

  // Pass 1: references.
  rows.forEach((row, i) => {
    const refs = [compact(row.reference), compact(row.utr)].filter(Boolean);
    const cands = payments.filter((p) => refs.some((r) => referenceMatches(r, p)));
    if (cands.length === 1) push(i, cands[0], "reference");
    else if (cands.length > 1) result.ambiguous.push({ rowIndex: i, row, candidatePaymentIds: cands.map((p) => p.id) });
    else pending.push(i);
  });

  // Pass 2: account + amount.
  for (const i of pending) {
    const row = rows[i];
    if (!row.accountNumber || row.amountPaise == null) {
      result.unmatched.push({ rowIndex: i, row });
      continue;
    }
    const scored = payments
      .filter((p) => p.amountPaise === row.amountPaise)
      .map((p) => ({ p, s: accountMatchStrength(row.accountNumber!, p) }))
      .filter((x) => x.s > 0);
    // Exact full-number matches outrank last-4 matches.
    const best = Math.max(0, ...scored.map((x) => x.s));
    const cands = scored.filter((x) => x.s === best).map((x) => x.p);
    const free = cands.filter((p) => !claimed.has(p.id));
    const pool = free.length ? free : cands;
    if (pool.length === 1) push(i, pool[0], "account_amount");
    else if (pool.length > 1) result.ambiguous.push({ rowIndex: i, row, candidatePaymentIds: pool.map((p) => p.id) });
    else result.unmatched.push({ rowIndex: i, row });
  }

  result.matched.sort((a, b) => a.rowIndex - b.rowIndex);
  result.ambiguous.sort((a, b) => a.rowIndex - b.rowIndex);
  result.unmatched.sort((a, b) => a.rowIndex - b.rowIndex);
  result.missingPaymentIds = payments.filter((p) => !claimed.has(p.id)).map((p) => p.id);
  return result;
}
