import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asUser, dbTestsEnabled, sql } from "./sql";

/**
 * Workspace isolation + the changed-bank-details rule, enforced by Postgres itself
 * (RLS policies and triggers), tested against the real database.
 * Run with: RUN_DB_TESTS=1 npx vitest run tests/db
 */
const d = dbTestsEnabled ? describe : describe.skip;

const A = randomUUID();
const B = randomUUID();
const wsA = randomUUID();
const wsB = randomUUID();
const vA = randomUUID();
const vB = randomUUID();
const bankB = randomUUID();
const bankA1 = randomUUID();

d("workspace isolation (RLS)", () => {
  beforeAll(async () => {
    const r = await sql(`
      insert into auth.users (id, aud, role, email) values ('${A}','authenticated','authenticated','rls-a-${A}@example.test'), ('${B}','authenticated','authenticated','rls-b-${B}@example.test');
      insert into public.workspaces (id, name, slug, created_by) values ('${wsA}','RLS A','rls-a','${A}'), ('${wsB}','RLS B','rls-b','${B}');
      insert into public.vendors (id, workspace_id, display_name, status) values ('${vA}','${wsA}','Vendor A','verified'), ('${vB}','${wsB}','Vendor B','verified');
      insert into public.vendor_bank_details (id, workspace_id, vendor_id, version, account_number_enc, account_last4, ifsc, status, approved_at)
        values ('${bankA1}','${wsA}','${vA}',1,'v1.x.y.z','1111','HDFC0001234','approved', now()),
               ('${bankB}','${wsB}','${vB}',1,'v1.x.y.z','2222','HDFC0001234','approved', now());
      insert into public.bills (workspace_id, vendor_id, invoice_number, due_date, amount_paise) values ('${wsB}','${vB}','B-1', current_date, 10000);
      select 1;`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }, 60000);

  afterAll(async () => {
    await sql(`delete from public.workspaces where id in ('${wsA}','${wsB}'); delete from auth.users where id in ('${A}','${B}');`);
  }, 60000);

  it("a user sees only their own workspaces", async () => {
    const r = await asUser<{ n: number }>(A, `select count(*)::int as n from public.workspaces where id in ('${wsA}','${wsB}');`);
    expect(r.ok && r.rows[0].n).toBe(1);
  });

  it("can't read another workspace's vendors, bank details or bills", async () => {
    const r = await asUser<{ v: number; b: number; bl: number }>(
      A,
      `select (select count(*)::int from public.vendors where workspace_id='${wsB}') as v,
              (select count(*)::int from public.vendor_bank_details where workspace_id='${wsB}') as b,
              (select count(*)::int from public.bills where workspace_id='${wsB}') as bl;`,
    );
    expect(r.ok && r.rows[0]).toEqual({ v: 0, b: 0, bl: 0 });
  });

  it("can't change another workspace's data", async () => {
    const upd = await asUser<{ n: number }>(A, `with u as (update public.vendors set display_name='hacked' where id='${vB}' returning 1) select count(*)::int as n from u;`);
    expect(upd.ok && upd.rows[0].n).toBe(0);
    const ins = await asUser(A, `insert into public.vendors (workspace_id, display_name) values ('${wsB}','x') returning id;`);
    expect(ins.ok).toBe(false);
    const rev = await asUser(A, `select public.review_bank_details('${bankB}', true);`);
    expect(rev.ok).toBe(false);
  });

  it("can't insert pre-approved bank details (forced to pending → vendor Changed)", async () => {
    const r = await asUser<{ status: string; vstatus: string }>(
      A,
      `insert into public.vendor_bank_details (workspace_id, vendor_id, version, account_number_enc, account_last4, ifsc, status)
         values ('${wsA}','${vA}',0,'v1.a.b.c','9999','SBIN0000001','approved');
       select (select status from public.vendor_bank_details where vendor_id='${vA}' order by version desc limit 1) as status,
              (select status from public.vendors where id='${vA}') as vstatus;`,
    );
    expect(r.ok && r.rows[0]).toEqual({ status: "pending", vstatus: "changed" });
  });

  it("can't mark a vendor verified directly (only via review)", async () => {
    const r = await asUser(A, `update public.vendors set status='verified' where id='${vA}' and status='verified'; update public.vendors set status='new' where id='${vA}';`);
    expect(r.ok).toBe(false);
  });

  it("blocks paying a vendor whose bank details changed until reviewed", async () => {
    const r = await asUser(
      A,
      `insert into public.vendor_bank_details (workspace_id, vendor_id, version, account_number_enc, account_last4, ifsc)
         values ('${wsA}','${vA}',0,'v1.a.b.c','8888','SBIN0000001');
       insert into public.payment_runs (id, workspace_id, run_number) values ('${randomUUID()}','${wsA}',0);
       insert into public.run_payments (workspace_id, run_id, vendor_id, bank_detail_id, amount_paise, method)
         select '${wsA}', id, '${vA}', '${bankA1}', 100, 'bank_file' from public.payment_runs where workspace_id='${wsA}' limit 1;`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not payable/);
  });

  it("allows paying after explicit approval", async () => {
    const r = await asUser<{ n: number }>(
      A,
      `insert into public.vendor_bank_details (id, workspace_id, vendor_id, version, account_number_enc, account_last4, ifsc)
         values ('${randomUUID()}','${wsA}','${vA}',0,'v1.a.b.c','7777','SBIN0000001');
       select public.review_bank_details((select id from public.vendor_bank_details where vendor_id='${vA}' and status='pending'), true);
       insert into public.payment_runs (workspace_id, run_number) values ('${wsA}',0);
       with p as (
         insert into public.run_payments (workspace_id, run_id, vendor_id, bank_detail_id, amount_paise, method)
         select '${wsA}', (select id from public.payment_runs where workspace_id='${wsA}' limit 1), '${vA}',
                (select id from public.vendor_bank_details where vendor_id='${vA}' and status='approved'), 100, 'bank_file'
         returning 1)
       select count(*)::int as n from p;`,
    );
    expect(r.ok && r.rows[0].n).toBe(1);
  });

  it("activity log is append-only", async () => {
    const r = await asUser<{ n: number }>(
      A,
      `insert into public.activity_log (workspace_id, actor_id, action) values ('${wsA}','${A}','test');
       with u as (update public.activity_log set action='tampered' where workspace_id='${wsA}' returning 1) select count(*)::int as n from u;`,
    );
    expect(r.ok && r.rows[0].n).toBe(0);
    // Even a privileged connection can't edit or delete entries (trigger).
    await sql(`insert into public.activity_log (workspace_id, actor_id, action) values ('${wsA}','${A}','kept');`);
    expect((await sql(`update public.activity_log set action='tampered' where workspace_id='${wsA}';`)).ok).toBe(false);
    expect((await sql(`delete from public.activity_log where workspace_id='${wsA}';`)).ok).toBe(false);
    const other = await asUser(A, `insert into public.activity_log (workspace_id, actor_id, action) values ('${wsB}','${A}','x');`);
    expect(other.ok).toBe(false);
  });

  it("anonymous (no session) can read nothing", async () => {
    const r = await sql(`begin; set local role anon; select count(*) from public.vendors;`);
    expect(r.ok).toBe(false);
  });
});
