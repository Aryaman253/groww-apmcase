# TArrow

**Pay all your vendors in one go.** / **सभी विक्रेताओं को एक साथ भुगतान करें।**

TArrow is a phone-first web app for small businesses (pharmacies, clinics, distributors, shops) that pay 20+ vendors every few days. It turns a day of one-by-one net-banking payments into a short **payment run**:

1. **Vendor book.** A trusted record of bank and UPI details, filled in on the device from a pasted message or a cheque photo. Any change to the details needs the owner's review before it can be paid.
2. **Due bills.** Bring them in from a Tally/Marg Excel or CSV export, an invoice photo or PDF, or by hand.
3. **Review and approve.** One screen, one payment per vendor, with warnings: new payee, unusual amount, possible duplicate, blocked vendor.
4. **Pay in one go**, three ways:
   - a bank bulk-upload file (one login, one OTP)
   - UPI deep links or QR codes
   - **Direct pay** through the business's own payout account (RazorpayX test mode, or the Cashfree sandbox).
5. **Close the run.** Upload the bank's status file or enter UTRs, mark bills paid, notify vendors on WhatsApp, and export the paid list.

TArrow **never holds or moves money** and **never stores bank logins or OTPs**. A person confirms every money step.

## Stack

- **App:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4 and shadcn/ui (Radix), next-intl (English and Hindi), next-themes
- **Backend:** Supabase (Auth with magic link and anonymous demo sessions, Postgres with RLS, migrations)
- **Libraries:** Zod, React Hook Form, SheetJS, qrcode
- **On-device OCR:** PaddleOCR PP-OCRv5 via `ppu-paddle-ocr` and `onnxruntime-web` in a Web Worker, with a Tesseract.js fallback; `pdfjs-dist` for PDFs
- **Tests:** Vitest and Playwright

## Local setup

```bash
npm install
cp .env.example .env.local      # fill in the values (see below)
npm run models:fetch            # downloads the OCR models into public/ (git-ignored, ~60 MB)
npm run dev                     # http://localhost:3000
```

Every environment variable is documented in [`.env.example`](.env.example). To generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> ⚠️ `ENCRYPTION_KEY` encrypts vendor account numbers and provider credentials (AES-256-GCM). Use the **same** key in every environment that shares the database, and never change it once data exists.

## Supabase setup

1. Create a free project (region: Mumbai, `ap-south-1`).
2. In **Authentication → Sign In / Providers**, enable **Email** (magic link) and **Allow anonymous sign-ins** (needed for the demo).
3. In **Authentication → URL Configuration**:
   - set **Site URL** to your production URL
   - add `http://localhost:3000/**` and `https://*.vercel.app/**` to the redirect URLs.
4. In **Project Settings → Integrations → GitHub**, connect this repo with working directory `.`, production branch `main`, and automatic migrations on.
5. Migrations live in `supabase/migrations/` (Supabase CLI format) and are applied **when merged to `main`**.
   - Every migration is additive and backward-compatible, because preview deployments share the same database.
   - Seed data lives in migrations (bank templates) and in a server-side routine (the demo). Nothing goes in `seed.sql`.
   - To apply migrations before merging (dev only), run:

```bash
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… npx tsx scripts/db-apply.ts
```

This records them in `supabase_migrations.schema_migrations`, so the GitHub integration skips them later.

**Security model**
- RLS is on for every table. A user only sees workspaces they're a member of. v1 has owners only; the `memberships.role` column is ready for staff roles later.
- Server actions also check ownership on every mutation and validate all input with Zod.
- Bank details are **versioned**: every change inserts a new `pending` version and moves the vendor to *Changed*. Payment is blocked until the owner reviews it. Postgres enforces this with triggers too, not just the UI.
- The activity log is append-only (enforced by a trigger).
- Account numbers are encrypted at the application level, and only `last4` is stored in clear.

## Deploy to Vercel

1. Import the GitHub repo in Vercel. The framework (Next.js) is detected automatically.
2. Add the environment variables from `.env.example` for both Production and Preview. Set `APP_URL` to your production URL.
3. `vercel.json` pins functions to **`bom1`** (Mumbai, next to the Supabase project) and adds the daily **keep-alive cron** (`/api/cron/keepalive`, protected by `CRON_SECRET`). That job keeps the free Supabase project from pausing and deletes demo workspaces older than 24 hours.
4. `npm run build` runs `models:fetch` first (`prebuild`), so the OCR models are served from the app's own origin. If the download fails, the build still succeeds and the browser falls back to Hugging Face.
5. **RazorpayX webhooks (optional).** In the RazorpayX dashboard (Test mode) → Webhooks:
   - add `https://<your-app>/api/webhooks/razorpayx`
   - events: `payout.processed`, `payout.failed`, `payout.reversed`, `payout.rejected`
   - put the secret you choose in `RAZORPAYX_WEBHOOK_SECRET`.
   - Without webhooks, statuses still update by polling.

## Direct pay (test mode only)

- **`PaymentRail` interface** (`src/lib/rails`). Implementations:
  - RazorpayX Payouts (test keys only: `rzp_test_…`)
  - Cashfree Payouts (sandbox)
  - bank bulk file
  - UPI handoff
  - a **simulated** test rail.
- **Who pays:**
  - Real workspaces connect their **own** provider test account in **More → Settings → Payments**. Credentials are encrypted and kept server-side.
  - The demo uses the app's own RazorpayX test keys when `RAZORPAYX_*` is set, otherwise the simulated rail. It's all fake money.
- **Safety:**
  - Before the first payout to each bank-details version, TArrow runs the provider's account validation and compares names. A mismatch blocks the payout until the owner explicitly overrides it.
  - It checks the balance first.
  - Each payment is atomically claimed and sent with a deterministic idempotency key (`tarrow-<run_payment.id>`), so retries and double taps never pay twice.
- **Statuses** arrive by signed webhook (`/api/webhooks/{razorpayx|cashfree|simulated}`) with polling as a fallback. Processed payouts mark their bills Paid. Failed or reversed payouts return bills to Due with the reason.
- **Simulated rail behaviour:** payouts settle after about 4 seconds. An amount ending in **.13 paise** fails, so you can try the failure path.
- **Feature flag:** `DIRECT_PAY_ENABLED` (default `true`).

## Tests and evals

```bash
npm run check          # lint + typecheck + i18n check (no missing Hindi keys) + unit tests
npm test               # Vitest
RUN_DB_TESTS=1 SUPABASE_ACCESS_TOKEN=… npx vitest run tests/db   # RLS / workspace isolation against the real DB
npm run e2e            # Playwright (phone 390×844 touch + desktop); needs the app running with Supabase
npm run eval           # auto-fill evals → evals/results.md
```

- **Unit tests** cover:
  - validators, including the GSTIN checksum
  - due dates and duplicate detection
  - per-vendor grouping and partial payments
  - run totals to the paisa
  - amount in words (English and Hindi)
  - **golden files** for each bank template
  - the changed-bank-details blocking rule
  - webhook signatures and idempotent transfer IDs.
- **DB tests** run as two real users against Postgres. They prove a user can't read or change another workspace's data, that pre-approved bank details can't be injected, that changed vendors can't be paid until approved, and that the activity log is append-only.
- **E2E tests** cover:
  - the demo happy path (run → bank file → status file → completed)
  - a changed vendor blocked until reviewed
  - Direct pay with webhooks for success and failure, and a double tap that pays once
  - theme persistence
  - no English left in the main flows in Hindi
  - desktop keyboard navigation.
  - For the webhook test, set `SIMULATED_RAIL_SECRET` in the test environment to the same value the app uses.
- **Auto-fill evals:** 40 synthetic fixtures. Latest run: **0 confident errors**, 98.4% field accuracy. The report also compares PaddleOCR with Tesseract. See [`evals/results.md`](evals/results.md).

Regenerate the icons from the master mark with `npm run icons`.

## 60-second demo walkthrough

1. Open the app and tap **Try the demo**. You get a private, fictional workspace (24 vendors, about 60 bills, 3 past runs) and a 3-step tour.
2. **Home** shows what's due, plus *Needs attention*: one vendor changed bank details, overdue bills, and a new vendor to approve.
3. Tap **Continue draft run**:
   1. **Select bills.** Try *Everything due*.
   2. **Review.** One card per vendor, editable amount, method and warnings. *Moonlight Medicos* is blocked: tap **Fix** to see old vs new details side by side, then approve with press-and-hold.
4. **Confirm.** See the total in words (English and Hindi), then press and hold to confirm.
5. **Pay.** *Direct pay (test mode)* sends the payouts and statuses update live. Alternatively, download the **bank file**, then upload a status file or type UTRs.
6. When the run completes, export the paid list to Excel, notify vendors on WhatsApp, or print the summary.
7. Also try:
   - **Vendors → Add vendor → Paste a message**, using a WhatsApp text with A/c and IFSC, read on the device
   - **Bills → Add bills → Import Excel** with *Try a sample export*
   - **More → Settings** for language, theme and payout provider.

## Project layout

```
src/app/(public)      landing, sign-in, onboarding, offline page
src/app/(app)         home, vendors, bills, pay (wizard + run view), more (reports, activity, bank accounts, settings, help), search
src/app/v/[token]     public "share your bank details" form (single-use link, rate-limited)
src/app/api           bank file, paid list, reports, statements, webhooks, cron
src/lib               validation, money, dates, amount-words, bankfile, payments, import, extract (parser), ocr (on-device), rails, server/*
supabase/migrations   schema, RLS, triggers, seeded bank templates
evals/                auto-fill fixtures + harness + results
tests/                db (RLS) and e2e (Playwright)
```
