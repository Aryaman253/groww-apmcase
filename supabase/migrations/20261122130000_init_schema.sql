-- TArrow initial schema. Additive only; see README "Database migrations".
-- Money is stored as integer paise (bigint). Account numbers are encrypted at the
-- application level (AES-256-GCM); only last4 is stored in clear for display.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Workspaces & memberships (v1: one owner per workspace; roles kept for later)
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  legal_name text,
  gstin text,
  phone text,
  email text,
  address text,
  is_demo boolean not null default false,
  demo_expires_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger workspaces_updated before update on public.workspaces
  for each row execute function public.set_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- Membership checks used by every RLS policy. SECURITY DEFINER so policies on
-- memberships itself don't recurse.
create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws and m.user_id = auth.uid() and w.deleted_at is null
  );
$$;

create or replace function public.is_workspace_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner' and w.deleted_at is null
  );
$$;

-- Creating a workspace makes its creator the owner.
create or replace function public.add_owner_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger workspaces_add_owner after insert on public.workspaces
  for each row execute function public.add_owner_membership();

-- ---------------------------------------------------------------------------
-- Bank file templates (configuration, not code). workspace_id null = system default.
-- ---------------------------------------------------------------------------
create table public.bank_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  config jsonb not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index bank_templates_system_key on public.bank_templates(key) where workspace_id is null;
create trigger bank_templates_updated before update on public.bank_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Debit accounts (the business's own bank accounts)
-- ---------------------------------------------------------------------------
create table public.debit_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bank_name text not null,
  nickname text not null,
  ifsc text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_last4 text not null check (account_last4 ~ '^\d{4}$'),
  account_number_enc text not null,
  bank_template_id uuid references public.bank_templates(id),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index debit_accounts_ws_idx on public.debit_accounts(workspace_id);
create trigger debit_accounts_updated before update on public.debit_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Vendors and versioned bank details
-- ---------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  legal_name text,
  gstin text,
  phone text,
  email text,
  credit_days integer not null default 30 check (credit_days between 0 and 365),
  notes text,
  -- new: never approved; verified: latest details approved; changed: a pending change awaits review
  status text not null default 'new' check (status in ('new', 'verified', 'changed')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index vendors_ws_idx on public.vendors(workspace_id) where deleted_at is null;
create index vendors_gstin_idx on public.vendors(workspace_id, gstin);
create trigger vendors_updated before update on public.vendors
  for each row execute function public.set_updated_at();

-- Vendor status only changes through the bank-details review path, never by a
-- direct client update (so "verified" can't be set without an approval).
create or replace function public.vendors_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('tarrow.internal', true), '') <> 'on' then
    raise exception 'vendor status changes only through bank-details review';
  end if;
  return new;
end $$;
create trigger vendors_status_guard before update on public.vendors
  for each row execute function public.vendors_status_guard();

create table public.vendor_bank_details (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  version integer not null,
  account_holder_name text,
  account_number_enc text,
  account_last4 text check (account_last4 is null or account_last4 ~ '^\d{4}$'),
  ifsc text check (ifsc is null or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text,
  branch text,
  upi_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  source text not null default 'manual' check (source in ('manual', 'autofill', 'vendor_link', 'import', 'demo')),
  -- result of provider bank-account verification (name returned, match flag, override)
  verification jsonb,
  created_by uuid default auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (vendor_id, version),
  check (account_number_enc is not null or upi_id is not null)
);
create index vbd_vendor_idx on public.vendor_bank_details(vendor_id, version desc);
-- at most one pending and one approved version per vendor
create unique index vbd_one_pending on public.vendor_bank_details(vendor_id) where status = 'pending';
create unique index vbd_one_approved on public.vendor_bank_details(vendor_id) where status = 'approved';

-- Any new bank-details version is pending; it moves the vendor to "changed"
-- (if it had approved details) so it is blocked from runs until reviewed.
create or replace function public.vbd_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  has_approved boolean;
begin
  select coalesce(max(version), 0) + 1 into new.version
    from public.vendor_bank_details where vendor_id = new.vendor_id;
  -- clients can never insert pre-approved details (demo seed uses the service path)
  if new.status <> 'pending' and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.status := 'pending';
  end if;
  perform set_config('tarrow.internal', 'on', true);
  -- a newer pending change replaces an older pending one
  update public.vendor_bank_details set status = 'superseded'
    where vendor_id = new.vendor_id and status = 'pending';
  select exists(select 1 from public.vendor_bank_details where vendor_id = new.vendor_id and status = 'approved')
    into has_approved;
  if new.status = 'pending' then
    update public.vendors set status = case when has_approved then 'changed' else 'new' end
      where id = new.vendor_id;
  end if;
  return new;
end $$;
create trigger vbd_before_insert before insert on public.vendor_bank_details
  for each row execute function public.vbd_before_insert();

-- Bank details are immutable except for review fields.
create or replace function public.vbd_guard_update() returns trigger
language plpgsql as $$
begin
  if new.account_number_enc is distinct from old.account_number_enc
     or new.ifsc is distinct from old.ifsc
     or new.upi_id is distinct from old.upi_id
     or new.account_holder_name is distinct from old.account_holder_name
     or new.vendor_id is distinct from old.vendor_id
     or new.version is distinct from old.version then
    raise exception 'bank details are versioned; insert a new version instead';
  end if;
  return new;
end $$;
create trigger vbd_guard_update before update on public.vendor_bank_details
  for each row execute function public.vbd_guard_update();

-- Owner review of a pending version. Explicit, never automatic.
create or replace function public.review_bank_details(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.vendor_bank_details;
begin
  select * into r from public.vendor_bank_details where id = p_id for update;
  if r.id is null or not public.is_workspace_owner(r.workspace_id) then
    raise exception 'not allowed';
  end if;
  if r.status <> 'pending' then
    raise exception 'only pending details can be reviewed';
  end if;
  perform set_config('tarrow.internal', 'on', true);
  if p_approve then
    update public.vendor_bank_details set status = 'superseded'
      where vendor_id = r.vendor_id and status = 'approved';
    update public.vendor_bank_details
      set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), approved_at = now()
      where id = p_id;
    update public.vendors set status = 'verified', verified_at = now() where id = r.vendor_id;
  else
    update public.vendor_bank_details
      set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_id;
    update public.vendors v set status = case
        when exists (select 1 from public.vendor_bank_details d where d.vendor_id = v.id and d.status = 'approved')
        then 'verified' else 'new' end
      where v.id = r.vendor_id;
  end if;
end $$;

create table public.vendor_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete cascade,
  token_hash text not null unique,
  lang text not null default 'en' check (lang in ('en', 'hi')),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index vendor_requests_ws_idx on public.vendor_requests(workspace_id);

-- ---------------------------------------------------------------------------
-- Bills
-- ---------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  invoice_number text not null,
  invoice_date date,
  due_date date not null,
  amount_paise bigint not null check (amount_paise > 0),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  gstin text,
  -- overdue is derived (due + due_date < today)
  status text not null default 'due' check (status in ('due', 'scheduled', 'paid', 'on_hold')),
  source text not null default 'manual' check (source in ('manual', 'import', 'invoice_image', 'invoice_pdf', 'demo')),
  paid_reference text,
  paid_at timestamptz,
  hold_reason text,
  notes text,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (status <> 'paid' or paid_reference is not null)
);
create index bills_ws_status_idx on public.bills(workspace_id, status, due_date) where deleted_at is null;
create index bills_vendor_idx on public.bills(vendor_id);
create trigger bills_updated before update on public.bills
  for each row execute function public.set_updated_at();

create table public.import_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  mapping jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- ---------------------------------------------------------------------------
-- Payment runs
-- ---------------------------------------------------------------------------
create table public.payment_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_number integer not null,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'in_progress', 'completed', 'partly_failed', 'cancelled')),
  up_to_date date,
  debit_account_id uuid references public.debit_accounts(id),
  total_paise bigint not null default 0,
  payment_count integer not null default 0,
  draft_state jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid,
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, run_number)
);
create index payment_runs_ws_idx on public.payment_runs(workspace_id, created_at desc);
create trigger payment_runs_updated before update on public.payment_runs
  for each row execute function public.set_updated_at();

create or replace function public.payment_runs_number() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.workspace_id::text));
  select coalesce(max(run_number), 0) + 1 into new.run_number
    from public.payment_runs where workspace_id = new.workspace_id;
  return new;
end $$;
create trigger payment_runs_number before insert on public.payment_runs
  for each row execute function public.payment_runs_number();

create table public.run_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.payment_runs(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  bank_detail_id uuid references public.vendor_bank_details(id),
  amount_paise bigint not null check (amount_paise > 0),
  method text not null check (method in ('direct', 'bank_file', 'upi')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'processing', 'paid', 'failed', 'reversed', 'skipped')),
  utr text,
  failure_reason text,
  provider text,
  provider_payout_id text,
  provider_status text,
  payment_mode text,
  remarks text,
  warnings jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, vendor_id),
  -- "paid" always needs a UTR/reference (direct-pay webhooks store the provider UTR)
  check (status <> 'paid' or utr is not null)
);
create index run_payments_run_idx on public.run_payments(run_id);
create unique index run_payments_provider_payout on public.run_payments(provider, provider_payout_id)
  where provider_payout_id is not null;
create trigger run_payments_updated before update on public.run_payments
  for each row execute function public.set_updated_at();

-- Defence in depth for the changed-bank-details rule: a payment can only use
-- the vendor's currently approved details, and only for a verified vendor.
create or replace function public.run_payments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  d_status text;
begin
  -- checked when a payment is created, and when it is first sent/initiated
  if tg_op = 'INSERT'
     or (new.status in ('sent', 'processing') and old.status = 'pending')
     or new.bank_detail_id is distinct from old.bank_detail_id then
    if new.status = 'skipped' then
      return new;
    end if;
    select status into v_status from public.vendors where id = new.vendor_id;
    select status into d_status from public.vendor_bank_details where id = new.bank_detail_id and vendor_id = new.vendor_id;
    if v_status is distinct from 'verified' or d_status is distinct from 'approved'
       or exists (select 1 from public.vendor_bank_details where vendor_id = new.vendor_id and status = 'pending') then
      raise exception 'vendor % is not payable: bank details need approval', new.vendor_id
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger run_payments_guard before insert or update on public.run_payments
  for each row execute function public.run_payments_guard();

create table public.run_payment_bills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_payment_id uuid not null references public.run_payments(id) on delete cascade,
  bill_id uuid not null references public.bills(id),
  amount_paise bigint not null check (amount_paise > 0),
  unique (run_payment_id, bill_id)
);
create index rpb_bill_idx on public.run_payment_bills(bill_id);

-- ---------------------------------------------------------------------------
-- Direct pay: payout providers (credentials encrypted by the app) and webhook events
-- ---------------------------------------------------------------------------
create table public.payout_providers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('razorpayx', 'cashfree', 'simulated')),
  mode text not null default 'test' check (mode = 'test'),
  credentials_enc text,
  account_number text,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  status_message text,
  uses_app_demo_keys boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger payout_providers_updated before update on public.payout_providers
  for each row execute function public.set_updated_at();

create table public.payout_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  run_payment_id uuid references public.run_payments(id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Activity log (append-only) and extraction logs (no raw text/images ever)
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid default auth.uid(),
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_ws_idx on public.activity_log(workspace_id, created_at desc);

create or replace function public.activity_log_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return old; -- cascade from workspace deletion (demo expiry)
  end if;
  raise exception 'activity log is append-only';
end $$;
create trigger activity_log_no_update before update on public.activity_log
  for each row execute function public.activity_log_immutable();
create trigger activity_log_no_delete before delete on public.activity_log
  for each row execute function public.activity_log_immutable();

create table public.extraction_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('vendor', 'invoice')),
  source_type text not null check (source_type in ('paste', 'image', 'pdf')),
  engine text,
  parser_version text not null,
  -- {field: {confidence: number, present: boolean}} — never the raw values or text
  fields jsonb not null default '{}'::jsonb,
  corrected_fields text[] not null default '{}',
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rate limiting for public endpoints (vendor request form)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into c;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return c <= p_max;
end $$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.bank_templates enable row level security;
alter table public.debit_accounts enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_bank_details enable row level security;
alter table public.vendor_requests enable row level security;
alter table public.bills enable row level security;
alter table public.import_presets enable row level security;
alter table public.payment_runs enable row level security;
alter table public.run_payments enable row level security;
alter table public.run_payment_bills enable row level security;
alter table public.payout_providers enable row level security;
alter table public.payout_events enable row level security;
alter table public.activity_log enable row level security;
alter table public.extraction_logs enable row level security;
alter table public.rate_limits enable row level security;

create policy ws_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id) or (created_by = auth.uid() and deleted_at is null));
create policy ws_insert on public.workspaces for insert to authenticated
  with check (created_by = auth.uid());
create policy ws_update on public.workspaces for update to authenticated
  using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

create policy mem_select on public.memberships for select to authenticated
  using (user_id = auth.uid());

create policy tpl_select on public.bank_templates for select to authenticated
  using (workspace_id is null or public.is_workspace_member(workspace_id));
create policy tpl_write on public.bank_templates for all to authenticated
  using (workspace_id is not null and public.is_workspace_owner(workspace_id))
  with check (workspace_id is not null and public.is_workspace_owner(workspace_id));

-- Owner-scoped CRUD for workspace data tables.
do $$
declare t text;
begin
  foreach t in array array['debit_accounts','vendors','vendor_requests','bills','import_presets',
                           'payment_runs','run_payments','run_payment_bills','payout_providers']
  loop
    execute format('create policy %1$s_owner on public.%1$s for all to authenticated
      using (public.is_workspace_owner(workspace_id))
      with check (public.is_workspace_owner(workspace_id))', t);
  end loop;
end $$;

-- Bank details: insert + read only (immutable); review goes through review_bank_details().
create policy vbd_select on public.vendor_bank_details for select to authenticated
  using (public.is_workspace_owner(workspace_id));
create policy vbd_insert on public.vendor_bank_details for insert to authenticated
  with check (public.is_workspace_owner(workspace_id) and status = 'pending');

-- Activity + extraction logs: append and read only.
create policy al_select on public.activity_log for select to authenticated
  using (public.is_workspace_owner(workspace_id));
create policy al_insert on public.activity_log for insert to authenticated
  with check (public.is_workspace_owner(workspace_id) and actor_id = auth.uid());
create policy el_select on public.extraction_logs for select to authenticated
  using (public.is_workspace_owner(workspace_id));
create policy el_insert on public.extraction_logs for insert to authenticated
  with check (public.is_workspace_owner(workspace_id));
-- payout_events, rate_limits: no client policies (server/service role only).

-- Least privilege for anon: nothing in public is readable without a session.
revoke all on all tables in schema public from anon;
