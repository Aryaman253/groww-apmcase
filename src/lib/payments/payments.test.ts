import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  approvedBankDetails,
  directPayIdempotencyKey,
  findDuplicateBills,
  formatInvoiceRemarks,
  groupBillsIntoPayments,
  isVendorPayable,
  matchVendor,
  normalizeInvoiceNumber,
  normalizeStatusText,
  normalizeVendorName,
  paymentReference,
  paymentWarnings,
  reconcileStatusRows,
  runStatusFromPayments,
  runTotals,
  suggestMethod,
  upiDeepLink,
  whatsappLink,
  type Bill,
  type PaymentHistoryEntry,
  type PaymentVendor,
} from ".";

const NOW = new Date("2026-11-22T06:30:00Z"); // 12:00 IST

const approvedV1 = {
  version: 1,
  status: "approved" as const,
  accountNumber: "000111222333",
  ifsc: "DEMO0000001",
  approvedAt: "2026-01-01T00:00:00Z",
};

function vendor(over: Partial<PaymentVendor> = {}): PaymentVendor {
  return { id: "v1", name: "Sunrise Pharma Distributors", status: "verified", bankDetails: [approvedV1], ...over };
}

describe("groupBillsIntoPayments / allocatePayment", () => {
  const bills: Bill[] = [
    { id: "b3", vendorId: "v1", invoiceNumber: "INV 103", invoiceDate: "2026-10-20", dueDate: "2026-11-20", amountPaise: 300_00 },
    { id: "b1", vendorId: "v1", invoiceNumber: "INV 101", invoiceDate: "2026-10-01", dueDate: "2026-11-01", amountPaise: 100_00 },
    { id: "b2", vendorId: "v1", invoiceNumber: "INV 102", invoiceDate: "2026-10-10", dueDate: "2026-11-10", amountPaise: 200_50 },
    { id: "c1", vendorId: "v2", invoiceNumber: "DEMO/INV/1042", invoiceDate: "2026-09-01", dueDate: "2026-10-01", amountPaise: 999_99 },
  ];
  const vendors = [
    { id: "v1", name: "Sunrise Pharma Distributors" },
    { id: "v2", name: "Ganga Medical Agencies" },
  ];

  it("groups per vendor with combined remarks, ordered by earliest due", () => {
    const out = groupBillsIntoPayments(bills, vendors);
    expect(out.map((p) => p.vendorId)).toEqual(["v2", "v1"]);
    const v1 = out[1];
    expect(v1.amountPaise).toBe(600_50);
    expect(v1.totalDuePaise).toBe(600_50);
    expect(v1.bills.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(v1.remarks).toBe("INV 101, 102, 103");
    expect(v1.fullyPaidBillIds).toEqual(["b1", "b2", "b3"]);
    expect(v1.error).toBeNull();
    expect(v1.vendorName).toBe("Sunrise Pharma Distributors");
  });

  it("allocates partial payments oldest-due-first", () => {
    const out = groupBillsIntoPayments(bills, vendors, { amounts: { v1: 250_00 } });
    const v1 = out.find((p) => p.vendorId === "v1")!;
    expect(v1.amountPaise).toBe(250_00);
    expect(v1.allocations).toEqual([
      { billId: "b1", amountPaise: 100_00, full: true },
      { billId: "b2", amountPaise: 150_00, full: false },
    ]);
    expect(v1.fullyPaidBillIds).toEqual(["b1"]);
    expect(v1.partlyPaidBillIds).toEqual(["b2"]);
    expect(v1.unpaidBillIds).toEqual(["b3"]);
    expect(v1.remarks).toBe("INV 101, 102");
  });

  it("validates partial amounts", () => {
    expect(allocatePayment(bills.slice(0, 3), 0)).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
    expect(allocatePayment(bills.slice(0, 3), 1.5)).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
    expect(allocatePayment(bills.slice(0, 3), 600_51)).toMatchObject({ ok: false, code: "AMOUNT_EXCEEDS_TOTAL" });
    expect(allocatePayment([], 100)).toMatchObject({ ok: false, code: "NO_BILLS" });
    expect(allocatePayment(bills.slice(0, 3), 600_50)).toMatchObject({ ok: true, partlyPaidBillIds: [] });
    const bad = groupBillsIntoPayments(bills, vendors, { amounts: { v1: -5 } }).find((p) => p.vendorId === "v1")!;
    expect(bad.error).toBe("INVALID_AMOUNT");
    expect(bad.amountPaise).toBe(0);
  });

  it("formats invoice remarks compactly", () => {
    expect(formatInvoiceRemarks(["INV 101", "INV 102", "INV 103", "INV 104", "INV 105"], 20)).toBe("INV 101, 102 +3 more");
    expect(formatInvoiceRemarks(["DEMO/INV/1042", "DEMO/INV/1043"])).toBe("DEMO/INV/1042, 1043");
    expect(formatInvoiceRemarks(["A1", "B2"])).toBe("A1, B2");
    expect(formatInvoiceRemarks(["X-1", "X-1", " "])).toBe("X-1");
    expect(formatInvoiceRemarks(["VERY-LONG-INVOICE-NUMBER-000000001", "VERY-LONG-INVOICE-NUMBER-000000002"], 20)).toBe(
      "VERY-LONG-IN +1 more",
    );
    expect(formatInvoiceRemarks([])).toBe("");
  });

  it("runTotals is exact", () => {
    const ps = Array.from({ length: 1000 }, () => ({ amountPaise: 10 })); // 0.10 × 1000 — floats would drift
    expect(runTotals(ps)).toEqual({ totalPaise: 10000, count: 1000 });
    expect(() => runTotals([{ amountPaise: 0.1 }])).toThrow(RangeError);
  });
});

describe("isVendorPayable — changed-bank-details blocking rule", () => {
  it("payable when verified with approved details", () => {
    expect(isVendorPayable(vendor(), { now: NOW })).toMatchObject({ payable: true, reasons: [] });
  });
  it("requires verified status", () => {
    expect(isVendorPayable(vendor({ status: "changed" }), { now: NOW }).reasons).toEqual(["VENDOR_NOT_VERIFIED"]);
  });
  it("blocks any pending change even though an older version is approved", () => {
    const v = vendor({ bankDetails: [approvedV1, { version: 2, status: "pending", accountNumber: "999988887777", ifsc: "FAKE0000009" }] });
    const r = isVendorPayable(v, { now: NOW });
    expect(r.payable).toBe(false);
    expect(r.reasons).toEqual(["CHANGED_AWAITING_APPROVAL"]);
    expect(r.approved).toBeNull();
    expect(approvedBankDetails(v)).toBeNull();
  });
  it("first details pending → BANK_NOT_APPROVED; none → MISSING_BANK_DETAILS", () => {
    expect(isVendorPayable(vendor({ bankDetails: [{ ...approvedV1, status: "pending" }] }), { now: NOW }).reasons).toEqual([
      "BANK_NOT_APPROVED",
    ]);
    expect(isVendorPayable(vendor({ bankDetails: [] }), { now: NOW }).reasons).toEqual(["MISSING_BANK_DETAILS"]);
    expect(isVendorPayable(vendor({ bankDetails: null }), { now: NOW }).reasons).toEqual(["MISSING_BANK_DETAILS"]);
  });
  it("ignores rejected change requests", () => {
    const v = vendor({ bankDetails: [approvedV1, { version: 2, status: "rejected", accountNumber: "999988887777", ifsc: "FAKE0000009" }] });
    expect(isVendorPayable(v, { now: NOW }).payable).toBe(true);
    expect(approvedBankDetails(v)?.version).toBe(1);
  });
  it("treats superseded versions as earlier approvals (DB keeps one approved row)", () => {
    const old = { ...approvedV1, status: "superseded" as const };
    const pend = vendor({ status: "changed", bankDetails: [old, { version: 2, status: "pending", accountLast4: "7777", ifsc: "FAKE0000009" }] });
    expect(isVendorPayable(pend, { now: NOW }).reasons).toEqual(["VENDOR_NOT_VERIFIED", "CHANGED_AWAITING_APPROVAL"]);
    const v2 = { version: 2, status: "approved" as const, accountLast4: "7777", ifsc: "FAKE0000009", approvedAt: "2026-11-22T00:00:00Z" };
    expect(isVendorPayable(vendor({ bankDetails: [old, v2] }), { now: NOW }).reasons).toEqual(["HOLD_PERIOD"]);
    // last4 + IFSC is enough for payability
    expect(isVendorPayable(vendor({ bankDetails: [{ ...v2, version: 1, approvedAt: null }] }), { now: NOW }).payable).toBe(true);
  });
  it("holds a changed version for 24h after approval", () => {
    const v2 = { version: 2, status: "approved" as const, accountNumber: "999988887777", ifsc: "FAKE0000009", approvedAt: "2026-11-22T00:00:00Z" };
    const v = vendor({ bankDetails: [approvedV1, v2] });
    const r = isVendorPayable(v, { now: NOW });
    expect(r.reasons).toEqual(["HOLD_PERIOD"]);
    expect(r.holdUntil).toBe("2026-11-23T00:00:00.000Z");
    expect(isVendorPayable(v, { now: new Date("2026-11-23T00:00:01Z") }).payable).toBe(true);
    expect(isVendorPayable(v, { now: NOW, hold: { enabled: false } }).payable).toBe(true);
    // First approval is not held by default.
    const fresh = vendor({ bankDetails: [{ ...v2, version: 1 }] });
    expect(isVendorPayable(fresh, { now: NOW }).payable).toBe(true);
    expect(isVendorPayable(fresh, { now: NOW, hold: { includeFirstApproval: true } }).reasons).toEqual(["HOLD_PERIOD"]);
  });
  it("approved version without usable details", () => {
    expect(isVendorPayable(vendor({ bankDetails: [{ version: 1, status: "approved", ifsc: "BAD" }] }), { now: NOW }).reasons).toEqual([
      "MISSING_BANK_DETAILS",
    ]);
  });
});

describe("suggestMethod", () => {
  it("prefers direct, then bank file, then UPI", () => {
    expect(suggestMethod(vendor(), { directPayAvailable: true })).toBe("direct");
    expect(suggestMethod(vendor(), { directPayAvailable: false })).toBe("bank_file");
    const upiOnly = vendor({ bankDetails: [{ version: 1, status: "approved", upiId: "sunrise@okdemo" }] });
    expect(suggestMethod(upiOnly, { directPayAvailable: false })).toBe("upi");
    expect(suggestMethod(upiOnly, { directPayAvailable: true })).toBe("direct");
    expect(suggestMethod(vendor({ bankDetails: [] }), { directPayAvailable: true })).toBeNull();
    expect(suggestMethod(vendor({ bankDetails: [{ ...approvedV1, status: "pending" }] }), { directPayAvailable: false })).toBeNull();
  });
});

describe("paymentWarnings", () => {
  const hist = (amountPaise: number, date: string, extra: Partial<PaymentHistoryEntry> = {}): PaymentHistoryEntry => ({
    vendorId: "v1",
    amountPaise,
    date,
    status: "paid",
    ...extra,
  });
  const history = [hist(20_000_00, "2026-08-01"), hist(25_000_00, "2026-09-01"), hist(22_000_00, "2026-10-01")];

  it("no warnings for a normal payment", () => {
    expect(paymentWarnings(vendor(), { amountPaise: 23_000_00 }, history, { now: NOW })).toEqual({
      blocking: false,
      excluded: false,
      warnings: [],
    });
  });
  it("NEW_PAYEE without history; no AMOUNT_UNUSUAL without history", () => {
    expect(paymentWarnings(vendor(), { amountPaise: 9_00_000_00 }, [], { now: NOW }).warnings).toEqual(["NEW_PAYEE"]);
    // failed payments don't count as history
    expect(paymentWarnings(vendor(), { amountPaise: 100 }, [hist(100, "2026-11-21", { status: "failed" })], { now: NOW }).warnings).toEqual([
      "NEW_PAYEE",
    ]);
  });
  it("NEW_PAYEE when the approved account was never paid", () => {
    const h = [hist(20_000_00, "2026-08-01", { accountNumber: "555566667777" })];
    expect(paymentWarnings(vendor(), { amountPaise: 20_000_00 }, h, { now: NOW }).warnings).toContain("NEW_PAYEE");
    const h2 = [hist(20_000_00, "2026-08-01", { accountNumber: "0001 1122 2333" })];
    expect(paymentWarnings(vendor(), { amountPaise: 20_000_00 }, h2, { now: NOW }).warnings).not.toContain("NEW_PAYEE");
  });
  it("AMOUNT_UNUSUAL needs > 2× median AND > ₹10,000 above it", () => {
    expect(paymentWarnings(vendor(), { amountPaise: 45_000_00 }, history, { now: NOW }).warnings).toEqual(["AMOUNT_UNUSUAL"]);
    expect(paymentWarnings(vendor(), { amountPaise: 44_000_00 }, history, { now: NOW }).warnings).toEqual([]);
    const small = [hist(1_000_00, "2026-08-01"), hist(1_000_00, "2026-09-01")];
    expect(paymentWarnings(vendor(), { amountPaise: 5_000_00 }, small, { now: NOW }).warnings).toEqual([]); // 5× but only ₹4,000 more
  });
  it("POSSIBLE_DUPLICATE: same amount in 7 days, or invoice/bill already paid", () => {
    const h = [...history, hist(23_000_00, "2026-11-16")];
    expect(paymentWarnings(vendor(), { amountPaise: 23_000_00 }, h, { now: NOW }).warnings).toEqual(["POSSIBLE_DUPLICATE"]);
    const old = [...history, hist(23_000_00, "2026-11-14")];
    expect(paymentWarnings(vendor(), { amountPaise: 23_000_00 }, old, { now: NOW }).warnings).toEqual([]);
    const inv = [...history, hist(1_00, "2026-01-01", { invoiceNumbers: ["INV-0042"] })];
    expect(paymentWarnings(vendor(), { amountPaise: 23_000_00, invoiceNumbers: ["inv 42"] }, inv, { now: NOW }).warnings).toEqual([
      "POSSIBLE_DUPLICATE",
    ]);
    const bill = [...history, hist(1_00, "2026-01-01", { billIds: ["b9"] })];
    expect(paymentWarnings(vendor(), { amountPaise: 23_000_00, billIds: ["b9"] }, bill, { now: NOW }).warnings).toEqual([
      "POSSIBLE_DUPLICATE",
    ]);
  });
  it("blocking and excluded flags", () => {
    const pendingChange = vendor({ bankDetails: [approvedV1, { version: 2, status: "pending" }] });
    expect(paymentWarnings(pendingChange, { amountPaise: 23_000_00 }, history, { now: NOW })).toMatchObject({
      blocking: true,
      excluded: false,
      warnings: ["CHANGED_AWAITING_APPROVAL"],
    });
    expect(paymentWarnings(vendor({ bankDetails: [] }), { amountPaise: 1_00 }, history, { now: NOW })).toMatchObject({
      blocking: false,
      excluded: true,
      warnings: ["MISSING_BANK_DETAILS"],
    });
    const held = vendor({ bankDetails: [approvedV1, { ...approvedV1, version: 2, approvedAt: "2026-11-22T01:00:00Z" }] });
    expect(paymentWarnings(held, { amountPaise: 23_000_00 }, history, { now: NOW })).toMatchObject({
      blocking: true,
      warnings: ["HOLD_PERIOD"],
    });
  });
});

describe("findDuplicateBills", () => {
  const existing: Bill[] = [
    { id: "e1", vendorId: "v1", invoiceNumber: "INV-0042", invoiceDate: "2026-10-01", amountPaise: 1000_00 },
    { id: "e2", vendorId: "v1", invoiceNumber: "INV-50", invoiceDate: "2026-10-05", amountPaise: 2500_00 },
    { id: "e3", vendorId: "v2", invoiceNumber: "INV-42", invoiceDate: "2026-10-01", amountPaise: 1000_00 },
  ];
  it("normalises invoice numbers", () => {
    expect(normalizeInvoiceNumber(" inv / 0042 ")).toBe("INV42");
    expect(normalizeInvoiceNumber("INV-007/24")).toBe("INV724");
    expect(normalizeInvoiceNumber("000")).toBe("0");
  });
  it("matches same vendor + invoice number, or amount + date", () => {
    expect(findDuplicateBills({ vendorId: "v1", invoiceNumber: "inv 42", amountPaise: 1 }, existing)).toEqual([
      { bill: existing[0], reason: "same_invoice_number" },
    ]);
    expect(
      findDuplicateBills({ vendorId: "v1", invoiceNumber: "X-9", invoiceDate: "2026-10-05", amountPaise: 2500_00 }, existing),
    ).toEqual([{ bill: existing[1], reason: "same_amount_and_date" }]);
    expect(findDuplicateBills({ vendorId: "v3", invoiceNumber: "INV-42", amountPaise: 1000_00 }, existing)).toEqual([]);
    expect(findDuplicateBills({ id: "e1", vendorId: "v1", invoiceNumber: "INV-0042", amountPaise: 1000_00 }, existing)).toEqual([]);
  });
});

describe("matchVendor", () => {
  const vendors = [
    { id: "a", name: "Sunrise Pharma Distributors", gstin: "27AAPFU0939F1ZV" },
    { id: "b", name: "Silverline Pharma", gstin: null },
    { id: "c", name: "Shree Balaji Surgicals", gstin: null },
    { id: "d", name: "Sunrise Surgicals", gstin: null },
  ];
  it("normalises names", () => {
    expect(normalizeVendorName("M/s. Shree Balaji Surgicals Pvt. Ltd.")).toBe("shree balaji surgicals");
  });
  it("GSTIN first", () => {
    expect(matchVendor({ gstin: "27aapfu0939f1zv", name: "Something Else" }, vendors)).toMatchObject({ match: vendors[0], kind: "gstin" });
  });
  it("exact normalised name", () => {
    expect(matchVendor({ name: "M/S SHREE BALAJI SURGICALS PVT LTD" }, vendors)).toMatchObject({ match: vendors[2], kind: "exact" });
  });
  it("exact name with conflicting GSTIN is not auto-matched", () => {
    const r = matchVendor({ name: "Sunrise Pharma Distributors", gstin: "29AAPFU0939F1ZR" }, vendors);
    expect(r.match).toBeNull();
    expect(r.suggestions[0].vendor.id).toBe("a");
  });
  it("fuzzy → suggestions only, never auto-assigned", () => {
    const r = matchVendor({ name: "Sunrise Pharma Dist." }, vendors);
    expect(r.match).toBeNull();
    expect(r.kind).toBeNull();
    expect(r.suggestions[0].vendor.id).toBe("a");
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
    expect(r.suggestions.every((s) => s.score >= 0.5 && s.score < 1)).toBe(true);
    expect(matchVendor({ name: "Completely Unrelated Name" }, vendors).suggestions).toEqual([]);
    expect(matchVendor({ name: "" }, vendors)).toEqual({ match: null, kind: null, suggestions: [] });
  });
});

describe("reconcileStatusRows", () => {
  it("normalises status words", () => {
    for (const s of ["Success", "SUCCESSFUL", "Paid", "Processed", "Completed", "Executed", "Credited"]) {
      expect(normalizeStatusText(s).status, s).toBe("success");
    }
    for (const s of ["Failed", "Rejected", "Returned", "Reversed", "Cancelled", "Not Processed", "Unsuccessful"]) {
      expect(normalizeStatusText(s).status, s).toBe("failed");
    }
    for (const s of ["Pending", "In Process", "In-Progress", "Processing", "Initiated", "Awaiting Authorisation"]) {
      expect(normalizeStatusText(s).status, s).toBe("pending");
    }
    expect(normalizeStatusText("???")).toEqual({ status: "pending", recognized: false, reason: null });
    expect(normalizeStatusText("Rejected - Invalid account number").reason).toBe("Invalid account number");
    expect(normalizeStatusText("Returned (Account closed)").reason).toBe("Account closed");
    expect(normalizeStatusText("Failed", "Beneficiary account frozen").reason).toBe("Beneficiary account frozen");
    expect(normalizeStatusText("Failed").reason).toBe("Failed");
  });

  const payments = [
    { id: "rp-aaaa1111", reference: "TA-R7-RPAAAA11", accountNumber: "000111222333", amountPaise: 1000_00 },
    { id: "rp-bbbb2222", reference: "TA-R7-RPBBBB22", accountNumber: "999988881234", amountPaise: 2500_00 },
    { id: "rp-cccc3333", reference: "TA-R7-RPCCCC33", accountLast4: "1234", amountPaise: 2500_00 },
    { id: "rp-dddd4444", reference: "TA-R7-RPDDDD44", accountNumber: "444455556666", amountPaise: 700_00 },
  ];

  it("matches by reference, then account+amount; flags ambiguous and unmatched", () => {
    const r = reconcileStatusRows(
      [
        { reference: "NEFT/TA-R7-RPAAAA11/xyz", status: "Success", utr: "UTR0001" },
        { accountNumber: "XXXXXXXX1234", amountPaise: 2500_00, status: "Paid" },
        { accountNumber: "444455556666", amountPaise: 700_00, status: "Rejected - Account closed" },
        { accountNumber: "000000000000", amountPaise: 5_00, status: "Paid" },
        { reference: "rp-bbbb2222", status: "In Process" },
      ],
      payments,
    );
    expect(r.matched.map((m) => [m.rowIndex, m.paymentId, m.by, m.status])).toEqual([
      [0, "rp-aaaa1111", "reference", "success"],
      // last4 1234 + ₹2,500 fits bbbb and cccc, but bbbb was already claimed by reference (row 4)
      [1, "rp-cccc3333", "account_amount", "success"],
      [2, "rp-dddd4444", "account_amount", "failed"],
      [4, "rp-bbbb2222", "reference", "pending"],
    ]);
    expect(r.matched[0].utr).toBe("UTR0001");
    expect(r.matched[2].reason).toBe("Account closed");
    expect(r.ambiguous).toEqual([]);
    expect(r.unmatched.map((u) => u.rowIndex)).toEqual([3]);
    expect(r.missingPaymentIds).toEqual([]);
  });

  it("is ambiguous when two unclaimed payments share last4 + amount", () => {
    const r = reconcileStatusRows([{ accountNumber: "XXXX1234", amountPaise: 2500_00, status: "Paid" }], payments);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].candidatePaymentIds.sort()).toEqual(["rp-bbbb2222", "rp-cccc3333"]);
    expect(r.matched).toEqual([]);
    expect(r.missingPaymentIds).toHaveLength(4);
  });

  it("full account number disambiguates", () => {
    const r = reconcileStatusRows([{ accountNumber: "999988881234", amountPaise: 2500_00, status: "Paid" }], payments);
    expect(r.matched.map((m) => m.paymentId)).toEqual(["rp-bbbb2222"]);
  });
});

describe("runStatusFromPayments", () => {
  it("derives run status", () => {
    expect(runStatusFromPayments(["pending", "pending"])).toBe("draft");
    expect(runStatusFromPayments(["pending", "pending"], { confirmed: true })).toBe("confirmed");
    expect(runStatusFromPayments(["sent", "pending"])).toBe("in_progress");
    expect(runStatusFromPayments(["paid", "processing"])).toBe("in_progress");
    expect(runStatusFromPayments(["paid", "paid", "skipped"])).toBe("completed");
    expect(runStatusFromPayments(["paid", "failed"])).toBe("partly_failed");
    expect(runStatusFromPayments(["paid", "reversed"])).toBe("partly_failed");
    expect(runStatusFromPayments(["failed", "reversed"])).toBe("partly_failed");
    expect(runStatusFromPayments([])).toBe("draft");
  });
});

describe("links", () => {
  it("builds UPI deep links", () => {
    expect(upiDeepLink({ pa: "Sunrise@okdemo", pn: "Sunrise Pharma & Co", amountPaise: 12345, tn: "INV 101, 102" })).toBe(
      "upi://pay?pa=sunrise@okdemo&pn=Sunrise%20Pharma%20%26%20Co&am=123.45&cu=INR&tn=INV%20101%2C%20102",
    );
    expect(upiDeepLink({ pa: "a.b@upi", pn: "X" })).toBe("upi://pay?pa=a.b@upi&pn=X&cu=INR");
    expect(() => upiDeepLink({ pa: "not a vpa", pn: "X" })).toThrow();
    expect(() => upiDeepLink({ pa: "a@upi", pn: "X", amountPaise: 0 })).toThrow();
  });
  it("builds WhatsApp links", () => {
    expect(whatsappLink("+91 98765-43210", "Paid ₹1,000 & thanks")).toBe(
      "https://wa.me/919876543210?text=Paid%20%E2%82%B91%2C000%20%26%20thanks",
    );
    expect(whatsappLink(null, "hi")).toBe("https://wa.me/?text=hi");
    expect(whatsappLink("12345", "hi")).toBe("https://wa.me/?text=hi");
  });
  it("idempotency key and reference", () => {
    expect(directPayIdempotencyKey("abc-123")).toBe("tarrow-abc-123");
    expect(directPayIdempotencyKey("abc-123")).toBe(directPayIdempotencyKey("abc-123"));
    const ref = paymentReference("R0007", "3f2b9c1e-1234-4abc-9def-000000000000");
    expect(ref).toBe("TA-R0007-3F2B9C1E");
    expect(paymentReference("X".repeat(60), "id")).toHaveLength(40);
    expect(paymentReference("r/7 ü", "id")).toMatch(/^[A-Z0-9-]{1,40}$/);
  });
});
