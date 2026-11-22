import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { addDays, todayIst } from "@/lib/dates";
import type { Insert } from "@/lib/supabase";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Seeds an isolated demo workspace with obviously fictional data.
 * Account numbers are dummy patterns (9100…); never real people's or businesses' accounts.
 */

type V = {
  name: string;
  ifsc?: string;
  upi?: string;
  credit: number;
  kind: "verified" | "missing" | "changed" | "newpayee" | "unreviewed" | "upionly";
  gstinBase?: string;
};

const VENDORS: V[] = [
  { name: "Sunrise Pharma Distributors", ifsc: "HDFC0001234", credit: 30, kind: "verified", gstinBase: "27AADCS1234A1Z" },
  { name: "Ganga Medical Agencies", ifsc: "SBIN0004321", credit: 21, kind: "verified", upi: "gangamedical@okaxis" },
  { name: "Shree Balaji Surgicals", ifsc: "ICIC0002468", credit: 30, kind: "verified" },
  { name: "Apex Lifecare Traders", ifsc: "UTIB0001357", credit: 45, kind: "verified", gstinBase: "27AAJFA4321B1Z" },
  { name: "Nilgiri Healthcare", ifsc: "KKBK0000987", credit: 30, kind: "verified" },
  { name: "Moonlight Medicos", ifsc: "PUNB0123400", credit: 15, kind: "changed" },
  { name: "Prakash Drug House", ifsc: "BARB0DEMOXX", credit: 30, kind: "verified", upi: "prakashdrug@ybl" },
  { name: "Vardhman Pharma", ifsc: "HDFC0004455", credit: 30, kind: "verified" },
  { name: "Kaveri Diagnostics Supply", ifsc: "CNRB0001122", credit: 60, kind: "verified" },
  { name: "Lotus Wellness Distributors", ifsc: "IDIB000L001", credit: 30, kind: "verified" },
  { name: "Himalaya Surgical Co", ifsc: "YESB0000123", credit: 30, kind: "verified" },
  { name: "Om Sai Medical Stores", credit: 7, kind: "upionly", upi: "omsaimedical@paytm" },
  { name: "Green Leaf Ayurveda Supply", credit: 30, kind: "missing" },
  { name: "Mehta Pharma Agencies", ifsc: "ICIC0003579", credit: 30, kind: "verified", gstinBase: "24AAKFM5678C1Z" },
  { name: "Riverbend Labs Supply", ifsc: "SBIN0007788", credit: 45, kind: "verified" },
  { name: "Coastal Medisales", ifsc: "UBIN0533211", credit: 30, kind: "verified", upi: "coastalmedi@okicici" },
  { name: "Sapphire Generics", ifsc: "HDFC0007001", credit: 30, kind: "newpayee" },
  { name: "Unity Health Traders", ifsc: "MAHB0000456", credit: 30, kind: "verified" },
  { name: "Deccan Bandage Works", ifsc: "UTIB0002468", credit: 30, kind: "verified", upi: "deccanbandage@ybl" },
  { name: "Silverline Pharma", ifsc: "KKBK0001472", credit: 30, kind: "verified" },
  { name: "Pinnacle Ortho Supplies", ifsc: "IBKL0000123", credit: 30, kind: "unreviewed" },
  { name: "Royal Chemists Wholesale", ifsc: "ICIC0005050", credit: 15, kind: "verified", upi: "royalchemists@okhdfcbank" },
  { name: "Tulsi Herbal Traders", credit: 30, kind: "missing" },
  { name: "Evergreen Diagnostics", ifsc: "SBIN0009999", credit: 30, kind: "newpayee" },
];

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstinWithCheck(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Deterministic pseudo-random so every demo looks the same. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const dummyAccount = (i: number, v = 0) => `91000${String(v).padStart(2, "0")}${String(1000 + i * 37).padStart(5, "0")}`;
const last4 = (a: string) => a.slice(-4);
const utr = (n: number) => `DEMOUTR${String(n).padStart(9, "0")}`;

export async function seedDemoWorkspace(userId: string): Promise<string> {
  const wsId = randomUUID();
  try {
    await seed(userId, wsId);
  } catch (e) {
    await deleteDemoWorkspace(wsId); // never leave a half-seeded demo behind
    throw e;
  }
  return wsId;
}

async function seed(userId: string, wsId: string) {
  const db = createAdminClient();
  const today = todayIst();
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  const r = rng(42);

  const { data: tpls } = await db.from("bank_templates").select("id, key").is("workspace_id", null);
  const tplId = (k: string) => tpls?.find((t) => t.key === k)?.id ?? null;

  const { error: wsErr } = await db.from("workspaces").insert({
    id: wsId,
    name: "Shubh Medicals (Demo)",
    slug: "shubh-medicals-demo",
    legal_name: "Shubh Medicals (Demo) — fictional business",
    is_demo: true,
    demo_expires_at: ago(-1),
    created_by: userId,
    settings: { hold24h: false, keepInvoiceImages: false } as Json,
  });
  if (wsErr) throw wsErr;

  const debitIcici = randomUUID();
  const debitHdfc = randomUUID();
  const { error: daErr } = await db.from("debit_accounts").insert([
    {
      id: debitIcici,
      workspace_id: wsId,
      bank_name: "ICICI Bank",
      nickname: "Main current account",
      ifsc: "ICIC0000001",
      account_last4: "4321",
      account_number_enc: encrypt("000105004321"),
      bank_template_id: tplId("icici_placeholder"),
      is_default: true,
    },
    {
      id: debitHdfc,
      workspace_id: wsId,
      bank_name: "HDFC Bank",
      nickname: "Collections account",
      ifsc: "HDFC0000001",
      account_last4: "8765",
      account_number_enc: encrypt("50200000008765"),
      bank_template_id: tplId("generic_csv"),
    },
  ], { defaultToNull: false });
  if (daErr) throw daErr;

  // Vendors
  const vendorIds = VENDORS.map(() => randomUUID());
  const vendorRows: Insert<"vendors">[] = VENDORS.map((v, i) => ({
    id: vendorIds[i],
    workspace_id: wsId,
    display_name: v.name,
    legal_name: v.name,
    gstin: v.gstinBase ? gstinWithCheck(v.gstinBase) : null,
    phone: `98${String(10000000 + i * 1234567).slice(0, 8)}`,
    credit_days: v.credit,
    status: v.kind === "missing" || v.kind === "unreviewed" ? "new" : "verified",
    verified_at: v.kind === "missing" || v.kind === "unreviewed" ? null : ago(v.kind === "newpayee" ? 3 : 90),
    created_at: ago(v.kind === "newpayee" ? 4 : 120),
  }));
  const { error: vErr } = await db.from("vendors").insert(vendorRows, { defaultToNull: false });
  if (vErr) throw vErr;

  // Approved bank details
  const approvedIds: Record<number, string> = {};
  const approvedRows: Insert<"vendor_bank_details">[] = [];
  VENDORS.forEach((v, i) => {
    if (v.kind === "missing" || v.kind === "unreviewed") return;
    const id = randomUUID();
    approvedIds[i] = id;
    const acct = v.kind === "upionly" ? null : dummyAccount(i);
    approvedRows.push({
      id,
      workspace_id: wsId,
      vendor_id: vendorIds[i],
      version: 1,
      account_holder_name: v.name.toUpperCase(),
      account_number_enc: acct ? encrypt(acct) : null,
      account_last4: acct ? last4(acct) : null,
      ifsc: acct ? v.ifsc! : null,
      bank_name: acct ? bankName(v.ifsc!) : null,
      upi_id: v.upi ?? null,
      status: "approved",
      source: "demo",
      approved_at: ago(v.kind === "newpayee" ? 3 : 90),
      reviewed_at: ago(v.kind === "newpayee" ? 3 : 90),
      created_at: ago(v.kind === "newpayee" ? 4 : 120),
    });
  });
  const { error: bErr } = await db.from("vendor_bank_details").insert(approvedRows, { defaultToNull: false });
  if (bErr) throw bErr;

  // Bills
  type B = Insert<"bills"> & { id: string; vendorIdx: number };
  const bills: B[] = [];
  let inv = 1040;
  const amounts = (base: number) => Math.round((base * (0.6 + r() * 0.9)) / 1000) * 1000; // paise, rounded to ₹10
  const addBill = (vendorIdx: number, invoiceDaysAgo: number, amount: number, status: "due" | "paid" | "on_hold" = "due") => {
    const v = VENDORS[vendorIdx];
    const invoiceDate = addDays(today, -invoiceDaysAgo);
    const b: B = {
      id: randomUUID(),
      vendorIdx,
      workspace_id: wsId,
      vendor_id: vendorIds[vendorIdx],
      invoice_number: `DEMO/INV/${inv++}`,
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, v.credit),
      amount_paise: amount,
      paid_paise: 0,
      status,
      source: "demo",
      hold_reason: status === "on_hold" ? "Short supply — waiting for credit note" : null,
      created_at: ago(invoiceDaysAgo),
    };
    bills.push(b);
    return b;
  };

  // Paid history for runs 1 and 2 (older invoices)
  const run1Vendors = [0, 1, 2, 3, 6, 7, 13];
  const run2Vendors = [4, 5, 9, 14, 15, 21];
  const run1Bills = run1Vendors.map((vi) => addBill(vi, 55, vi === 7 ? 800000 : amounts(2500000)));
  const run2Bills = run2Vendors.map((vi) => addBill(vi, 40, amounts(1800000)));

  // Current dues — mix of overdue, due soon and later
  const dueVendors = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  dueVendors.forEach((vi, k) => {
    const daysAgo = [38, 33, 26, 20, 12, 6][k % 6];
    addBill(vi, daysAgo, amounts(1500000));
    if (k % 2 === 0) addBill(vi, Math.max(1, daysAgo - 9), amounts(900000));
  });
  // Unusually large bill for Vardhman (usual ≈ ₹8,000)
  addBill(7, 24, 9500000);
  // A second big one (RTGS-sized) for Sunrise
  addBill(0, 18, 26000000);
  // Two on hold
  addBill(10, 15, amounts(700000), "on_hold");
  addBill(18, 9, amounts(500000), "on_hold");
  // Duplicate invoice (same vendor + same invoice number as an existing due bill)
  const original = bills.find((b) => b.vendorIdx === 9 && b.status === "due" && !run2Bills.includes(b))!;
  bills.push({ ...original, id: randomUUID(), created_at: ago(1), notes: "Received twice on WhatsApp" });

  // Paid bills (marked paid by run 1 / run 2 below)
  const run1Utr = new Map<string, string>();
  run1Bills.forEach((b, i) => {
    b.status = "paid";
    b.paid_paise = b.amount_paise;
    b.paid_reference = utr(100 + i);
    b.paid_at = ago(24);
    run1Utr.set(b.id, utr(100 + i));
  });
  run2Bills.forEach((b, i) => {
    if (b.vendorIdx === 14) return; // failed payment → stays due
    b.status = "paid";
    b.paid_paise = b.amount_paise;
    b.paid_reference = utr(200 + i);
    b.paid_at = ago(11);
  });
  // A few older manual payments to round out ~60 bills and history
  [0, 1, 3, 6, 13, 17, 19].forEach((vi, i) => {
    const b = addBill(vi, 80 + i * 3, amounts(2000000), "paid");
    b.paid_paise = b.amount_paise;
    b.paid_reference = `DEMOREF${700 + i}`;
    b.paid_at = ago(50 + i);
  });

  const { error: billErr } = await db
    .from("bills")
    .insert(bills.map(({ vendorIdx: _v, ...b }) => { void _v; return b; }), { defaultToNull: false });
  if (billErr) throw billErr;

  // Runs
  const run1 = randomUUID();
  const run2 = randomUUID();
  const run3 = randomUUID();
  const sum = (xs: B[]) => xs.reduce((s, b) => s + (b.amount_paise as number), 0);
  await db.from("payment_runs").insert({
    id: run1, workspace_id: wsId, run_number: 0, status: "completed", up_to_date: addDays(today, -24),
    debit_account_id: debitIcici, total_paise: sum(run1Bills), payment_count: run1Bills.length,
    confirmed_at: ago(25), confirmed_by: userId, completed_at: ago(24), created_by: userId, created_at: ago(25),
  });
  await db.from("payment_runs").insert({
    id: run2, workspace_id: wsId, run_number: 0, status: "partly_failed", up_to_date: addDays(today, -11),
    debit_account_id: debitIcici, total_paise: sum(run2Bills), payment_count: run2Bills.length,
    confirmed_at: ago(12), confirmed_by: userId, completed_at: ago(11), created_by: userId, created_at: ago(12),
  });
  const draftBills = bills.filter((b) => b.status === "due" && b.vendorIdx in approvedIds && b.vendorIdx !== 5).slice(0, 5);
  await db.from("payment_runs").insert({
    id: run3, workspace_id: wsId, run_number: 0, status: "draft", up_to_date: addDays(today, 3),
    debit_account_id: debitIcici, total_paise: sum(draftBills), payment_count: new Set(draftBills.map((b) => b.vendorIdx)).size,
    draft_state: { step: "select", selectedBillIds: draftBills.map((b) => b.id) } as Json,
    created_by: userId, created_at: ago(1),
  });

  const payments: Insert<"run_payments">[] = [];
  const links: Insert<"run_payment_bills">[] = [];
  run1Bills.forEach((b, i) => {
    const id = randomUUID();
    payments.push({
      id, workspace_id: wsId, run_id: run1, vendor_id: b.vendor_id, bank_detail_id: approvedIds[b.vendorIdx],
      amount_paise: b.amount_paise, method: "bank_file", status: "paid", utr: utr(100 + i),
      remarks: b.invoice_number, payment_mode: "NEFT", sent_at: ago(25), resolved_at: ago(24),
    });
    links.push({ workspace_id: wsId, run_payment_id: id, bill_id: b.id, amount_paise: b.amount_paise });
  });
  run2Bills.forEach((b, i) => {
    const id = randomUUID();
    const failed = b.vendorIdx === 14;
    payments.push({
      id, workspace_id: wsId, run_id: run2, vendor_id: b.vendor_id, bank_detail_id: approvedIds[b.vendorIdx],
      amount_paise: b.amount_paise, method: i % 2 ? "direct" : "bank_file", status: failed ? "failed" : "paid",
      utr: failed ? null : utr(200 + i), failure_reason: failed ? "Beneficiary bank rejected: account details mismatch" : null,
      remarks: b.invoice_number, payment_mode: "IMPS", sent_at: ago(12), resolved_at: ago(11),
      provider: i % 2 ? "simulated" : null,
    });
    links.push({ workspace_id: wsId, run_payment_id: id, bill_id: b.id, amount_paise: b.amount_paise });
  });
  const { error: pErr } = await db.from("run_payments").insert(payments, { defaultToNull: false });
  if (pErr) throw pErr;
  const { error: lErr } = await db.from("run_payment_bills").insert(links, { defaultToNull: false });
  if (lErr) throw lErr;

  // Pending changes (after payments, which require approved-only vendors)
  const moonlight = VENDORS.findIndex((v) => v.kind === "changed");
  const pinnacle = VENDORS.findIndex((v) => v.kind === "unreviewed");
  const newAcct = dummyAccount(moonlight, 7);
  const pinAcct = dummyAccount(pinnacle);
  const { error: pendErr } = await db.from("vendor_bank_details").insert(
    [
    {
      workspace_id: wsId, vendor_id: vendorIds[moonlight], version: 2,
      account_holder_name: "MOONLIGHT MEDICOS", account_number_enc: encrypt(newAcct), account_last4: last4(newAcct),
      ifsc: "IDFB0040101", bank_name: "IDFC First Bank", status: "pending", source: "vendor_link", created_at: ago(0.2),
    },
    {
      workspace_id: wsId, vendor_id: vendorIds[pinnacle], version: 1,
      account_holder_name: "PINNACLE ORTHO SUPPLIES", account_number_enc: encrypt(pinAcct), account_last4: last4(pinAcct),
      ifsc: VENDORS[pinnacle].ifsc!, bank_name: bankName(VENDORS[pinnacle].ifsc!), status: "pending", source: "autofill", created_at: ago(2),
    },
    ],
    { defaultToNull: false },
  );
  if (pendErr) throw pendErr;

  // Direct pay in the demo: app's own RazorpayX test keys if configured, else the simulated test rail.
  const useRzp = Boolean(process.env.RAZORPAYX_KEY_ID && process.env.RAZORPAYX_KEY_SECRET && process.env.RAZORPAYX_ACCOUNT_NUMBER);
  await db.from("payout_providers").insert({
    workspace_id: wsId,
    provider: useRzp ? "razorpayx" : "simulated",
    uses_app_demo_keys: true,
    account_number: useRzp ? process.env.RAZORPAYX_ACCOUNT_NUMBER! : "SIMULATED-TEST",
    status: "connected",
  });

  await db.from("activity_log").insert([
    { workspace_id: wsId, actor_id: userId, action: "run.confirmed", entity_type: "run", entity_id: run1, details: { run_number: 1 }, created_at: ago(25) },
    { workspace_id: wsId, actor_id: userId, action: "run.completed", entity_type: "run", entity_id: run1, details: { run_number: 1 }, created_at: ago(24) },
    { workspace_id: wsId, actor_id: userId, action: "run.confirmed", entity_type: "run", entity_id: run2, details: { run_number: 2 }, created_at: ago(12) },
    { workspace_id: wsId, actor_id: null, action: "bank_details.changed", entity_type: "vendor", entity_id: vendorIds[moonlight],
      details: { source: "vendor_link", old_last4: last4(dummyAccount(moonlight)), new_last4: last4(newAcct), old_ifsc: VENDORS[moonlight].ifsc!, new_ifsc: "IDFB0040101" }, created_at: ago(0.2) },
  ], { defaultToNull: false });
}

function bankName(ifsc: string) {
  const map: Record<string, string> = {
    HDFC: "HDFC Bank", SBIN: "State Bank of India", ICIC: "ICICI Bank", UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank",
    PUNB: "Punjab National Bank", BARB: "Bank of Baroda", CNRB: "Canara Bank", IDIB: "Indian Bank", YESB: "Yes Bank",
    UBIN: "Union Bank of India", MAHB: "Bank of Maharashtra", IBKL: "IDBI Bank", IDFB: "IDFC First Bank",
  };
  return map[ifsc.slice(0, 4)] ?? "Bank";
}

/** Deletes a demo workspace (cascade). Only demo workspaces. */
export async function deleteDemoWorkspace(wsId: string) {
  const db = createAdminClient();
  await db.from("workspaces").delete().eq("id", wsId).eq("is_demo", true);
}
