import type { Bill } from "./types";

export interface BillAllocation {
  billId: string;
  amountPaise: number;
  /** true when this allocation clears the bill's outstanding amount. */
  full: boolean;
}

export type AllocationErrorCode = "NO_BILLS" | "INVALID_AMOUNT" | "AMOUNT_EXCEEDS_TOTAL";

export type AllocationResult =
  | {
      ok: true;
      totalDuePaise: number;
      amountPaise: number;
      allocations: BillAllocation[];
      fullyPaidBillIds: string[];
      partlyPaidBillIds: string[];
      unpaidBillIds: string[];
    }
  | { ok: false; code: AllocationErrorCode; totalDuePaise: number };

/** Oldest due first (due date, else invoice date; undated last), then invoice date, then invoice number. */
export function sortBillsOldestDueFirst<B extends Bill>(bills: B[]): B[] {
  const key = (b: Bill) => b.dueDate ?? b.invoiceDate ?? "9999-12-31";
  return [...bills].sort(
    (a, b) =>
      key(a).localeCompare(key(b)) ||
      (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") ||
      a.invoiceNumber.localeCompare(b.invoiceNumber, "en", { numeric: true }),
  );
}

/**
 * Allocates a (possibly partial) payment to bills, oldest due first.
 * amountPaise must be a positive integer ≤ total outstanding. Omit for full payment.
 */
export function allocatePayment(bills: Bill[], amountPaise?: number): AllocationResult {
  const payable = sortBillsOldestDueFirst(bills.filter((b) => b.amountPaise > 0));
  const totalDuePaise = payable.reduce((s, b) => s + b.amountPaise, 0);
  if (!payable.length) return { ok: false, code: "NO_BILLS", totalDuePaise };
  const amount = amountPaise ?? totalDuePaise;
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, code: "INVALID_AMOUNT", totalDuePaise };
  if (amount > totalDuePaise) return { ok: false, code: "AMOUNT_EXCEEDS_TOTAL", totalDuePaise };

  let left = amount;
  const allocations: BillAllocation[] = [];
  const fullyPaidBillIds: string[] = [];
  const partlyPaidBillIds: string[] = [];
  const unpaidBillIds: string[] = [];
  for (const b of payable) {
    if (left <= 0) {
      unpaidBillIds.push(b.id);
      continue;
    }
    const a = Math.min(left, b.amountPaise);
    left -= a;
    const full = a === b.amountPaise;
    allocations.push({ billId: b.id, amountPaise: a, full });
    (full ? fullyPaidBillIds : partlyPaidBillIds).push(b.id);
  }
  return { ok: true, totalDuePaise, amountPaise: amount, allocations, fullyPaidBillIds, partlyPaidBillIds, unpaidBillIds };
}

/**
 * Combines invoice numbers into a short remark, e.g.
 * ["INV 101","INV 102","INV 103","INV 104","INV 105"] → "INV 101, 102 +3 more".
 * A shared prefix (up to the trailing digits) is shown only on the first number.
 */
export function formatInvoiceRemarks(invoiceNumbers: string[], maxLength = 30): string {
  const nums = [...new Set(invoiceNumbers.map((n) => n.trim()).filter(Boolean))];
  if (!nums.length) return "";
  let prefix = nums.reduce((p, n) => {
    let i = 0;
    while (i < p.length && i < n.length && p[i] === n[i]) i++;
    return p.slice(0, i);
  });
  prefix = prefix.replace(/\d+$/, "");
  if (nums.length < 2 || nums.some((n) => n.length === prefix.length)) prefix = "";
  const parts = nums.map((n, i) => (i === 0 ? n : n.slice(prefix.length)));
  for (let k = parts.length; k >= 1; k--) {
    const more = k < parts.length ? ` +${parts.length - k} more` : "";
    const s = parts.slice(0, k).join(", ") + more;
    if (s.length <= maxLength) return s;
  }
  const more = parts.length > 1 ? ` +${parts.length - 1} more` : "";
  return nums[0].slice(0, Math.max(1, maxLength - more.length)).trimEnd() + more;
}

export interface ProposedPayment<V> {
  vendorId: string;
  vendor: V | null;
  vendorName: string;
  /** All outstanding bills of this vendor, oldest due first. */
  bills: Bill[];
  totalDuePaise: number;
  /** Amount to pay (= totalDuePaise unless overridden). 0 when `error` is set. */
  amountPaise: number;
  allocations: BillAllocation[];
  fullyPaidBillIds: string[];
  partlyPaidBillIds: string[];
  unpaidBillIds: string[];
  /** Invoice numbers of bills receiving money, in allocation order. */
  invoiceNumbers: string[];
  remarks: string;
  error: AllocationErrorCode | null;
}

/**
 * Groups bills per vendor into one payment each. `amounts` optionally sets a
 * partial amount per vendorId (allocated oldest-due-first). Invalid amounts set
 * `error` on that payment instead of throwing. Output is ordered by earliest due date.
 */
export function groupBillsIntoPayments<V extends { id: string; name: string }>(
  bills: Bill[],
  vendors: V[],
  opts: { amounts?: Record<string, number>; remarksMaxLength?: number } = {},
): ProposedPayment<V>[] {
  const byVendor = new Map<string, Bill[]>();
  for (const b of bills) {
    const list = byVendor.get(b.vendorId) ?? [];
    list.push(b);
    byVendor.set(b.vendorId, list);
  }
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const out: ProposedPayment<V>[] = [];
  for (const [vendorId, list] of byVendor) {
    const vendor = vendorById.get(vendorId) ?? null;
    const sorted = sortBillsOldestDueFirst(list);
    const res = allocatePayment(sorted, opts.amounts?.[vendorId]);
    const billById = new Map(sorted.map((b) => [b.id, b]));
    const allocations = res.ok ? res.allocations : [];
    const invoiceNumbers = allocations.map((a) => billById.get(a.billId)!.invoiceNumber);
    out.push({
      vendorId,
      vendor,
      vendorName: vendor?.name ?? "",
      bills: sorted,
      totalDuePaise: res.totalDuePaise,
      amountPaise: res.ok ? res.amountPaise : 0,
      allocations,
      fullyPaidBillIds: res.ok ? res.fullyPaidBillIds : [],
      partlyPaidBillIds: res.ok ? res.partlyPaidBillIds : [],
      unpaidBillIds: res.ok ? res.unpaidBillIds : sorted.map((b) => b.id),
      invoiceNumbers,
      remarks: formatInvoiceRemarks(invoiceNumbers, opts.remarksMaxLength),
      error: res.ok ? null : res.code,
    });
  }
  const firstDue = (p: ProposedPayment<V>) => p.bills[0]?.dueDate ?? p.bills[0]?.invoiceDate ?? "9999-12-31";
  return out.sort((a, b) => firstDue(a).localeCompare(firstDue(b)) || a.vendorName.localeCompare(b.vendorName));
}

/** Total and count of a run, exact to the paisa. Throws on non-integer amounts. */
export function runTotals(payments: { amountPaise: number }[]): { totalPaise: number; count: number } {
  let totalPaise = 0;
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amountPaise)) throw new RangeError("runTotals: amountPaise must be an integer");
    totalPaise += p.amountPaise;
  }
  if (!Number.isSafeInteger(totalPaise)) throw new RangeError("runTotals: total overflow");
  return { totalPaise, count: payments.length };
}
