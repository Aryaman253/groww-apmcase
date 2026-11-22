import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { railFor, RailError, type PayoutMode, type PayoutResult, type ProviderRefs, type ProviderRow } from "@/lib/rails";
import { directPayIdempotencyKey } from "@/lib/payments";
import { nameMatchScore } from "@/lib/validation";
import { applyPaymentOutcome } from "./runs";
import type { Json } from "@/lib/supabase/database.types";

export type Verification = {
  provider?: string;
  status?: "valid" | "invalid" | "unavailable";
  nameAtBank?: string | null;
  nameMatch?: boolean;
  overridden?: boolean;
  overriddenAt?: string;
  checkedAt?: string;
  refs?: Record<string, ProviderRefs>;
};

export function chooseMode(amountPaise: number, hasAccount: boolean, rtgsMinPaise = 2_00_000_00): PayoutMode {
  if (!hasAccount) return "UPI";
  return amountPaise >= rtgsMinPaise ? "RTGS" : "IMPS";
}

export function mapResultToOutcome(r: Pick<PayoutResult, "status" | "utr" | "failureReason" | "providerStatus">) {
  if (r.status === "processed" && r.utr) return { kind: "paid" as const, utr: r.utr };
  if (r.status === "processed") return { kind: "processing" as const, providerStatus: "processed_awaiting_utr" };
  if (r.status === "failed") return { kind: "failed" as const, reason: r.failureReason ?? "Payout failed" };
  if (r.status === "reversed") return { kind: "reversed" as const, reason: r.failureReason ?? "Payout reversed" };
  return { kind: "processing" as const, providerStatus: r.providerStatus };
}

type StartResult =
  | { ok: true; created: number; needsOverride: string[] }
  | { ok: false; error: "NO_PROVIDER" | "INSUFFICIENT_BALANCE" | "PROVIDER" | "NOTHING"; message?: string; balancePaise?: number };

/**
 * Sends one payout per pending direct-pay run payment.
 * Safety: account verification + name check before the first payout to each
 * bank-details version; balance check first; each payment is atomically claimed
 * (pending → processing) before calling the provider, and the provider gets a
 * deterministic idempotency key, so retries/double taps never pay twice.
 * The caller must have verified workspace ownership.
 */
export async function startDirectPayForRun(workspaceId: string, runId: string, overrides: string[], rtgsMinPaise?: number): Promise<StartResult> {
  const db = createAdminClient();
  const { data: prov } = await db.from("payout_providers").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (!prov || prov.status !== "connected") return { ok: false, error: "NO_PROVIDER" };
  const rail = railFor(prov as ProviderRow);
  const { data: pays } = await db
    .from("run_payments")
    .select("id, amount_paise, remarks, bank_detail_id, vendor_id, vendors(display_name, legal_name, email, phone), vendor_bank_details(id, account_holder_name, account_number_enc, ifsc, upi_id, verification)")
    .eq("run_id", runId)
    .eq("workspace_id", workspaceId)
    .eq("method", "direct")
    .eq("status", "pending");
  if (!pays?.length) return { ok: false, error: "NOTHING" };

  // 1) Verify accounts (first payout to this bank-details version) and check names.
  const needsOverride: string[] = [];
  const ready: typeof pays = [];
  for (const p of pays) {
    const d = p.vendor_bank_details;
    if (!d) continue;
    let ver = (d.verification ?? {}) as Verification;
    const bene = {
      ref: d.id,
      name: d.account_holder_name || p.vendors?.display_name || "Vendor",
      accountNumber: d.account_number_enc ? decrypt(d.account_number_enc) : null,
      ifsc: d.ifsc,
      upiId: d.upi_id,
      email: p.vendors?.email,
      phone: p.vendors?.phone,
    };
    if (!ver.checkedAt || ver.provider !== rail.id) {
      const v = await rail.verifyAccount(bene, ver.refs?.[rail.id]);
      const vendorNames = [p.vendors?.display_name, p.vendors?.legal_name, d.account_holder_name].filter(Boolean) as string[];
      const nameMatch = v.nameAtBank ? vendorNames.some((n) => nameMatchScore(v.nameAtBank!, n) >= 0.5) : undefined;
      ver = {
        ...ver,
        provider: rail.id,
        status: v.status,
        nameAtBank: v.nameAtBank ?? null,
        nameMatch: v.status === "invalid" ? false : nameMatch,
        checkedAt: new Date().toISOString(),
        refs: { ...(ver.refs ?? {}), ...(v.refs ? { [rail.id]: v.refs } : {}) },
      };
      await db.from("vendor_bank_details").update({ verification: ver as unknown as Json }).eq("id", d.id);
      await db.from("activity_log").insert({ workspace_id: workspaceId, action: "bank_details.verified", entity_type: "vendor", entity_id: p.vendor_id, details: { status: v.status, name_match: ver.nameMatch ?? null, provider: rail.id } });
    }
    if (ver.nameMatch === false && !ver.overridden) {
      if (overrides.includes(p.id)) {
        ver = { ...ver, overridden: true, overriddenAt: new Date().toISOString() };
        await db.from("vendor_bank_details").update({ verification: ver as unknown as Json }).eq("id", d.id);
        await db.from("activity_log").insert({ workspace_id: workspaceId, action: "bank_details.verified", entity_type: "vendor", entity_id: p.vendor_id, details: { override: true, name_at_bank: ver.nameAtBank ?? null } });
      } else {
        needsOverride.push(p.id);
        continue;
      }
    }
    (d as { verification: unknown }).verification = ver;
    ready.push(p);
  }
  if (!ready.length) return { ok: true, created: 0, needsOverride };

  // 2) Balance check.
  const need = ready.reduce((s, p) => s + p.amount_paise, 0);
  try {
    const bal = await rail.getBalance();
    if (bal !== null && bal < need) return { ok: false, error: "INSUFFICIENT_BALANCE", balancePaise: bal };
  } catch {
    /* balance unavailable: the payout itself fails clearly on low balance */
  }

  // 3) Claim + create payouts.
  let created = 0;
  for (const p of ready) {
    const d = p.vendor_bank_details!;
    const ver = (d.verification ?? {}) as Verification;
    const { data: claimed } = await db
      .from("run_payments")
      .update({ status: "processing", provider: rail.id, sent_at: new Date().toISOString(), payment_mode: chooseMode(p.amount_paise, Boolean(d.account_number_enc), rtgsMinPaise) })
      .eq("id", p.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue; // already claimed by a concurrent tap
    try {
      const res = await rail.createPayout({
        idempotencyKey: directPayIdempotencyKey(p.id),
        referenceId: p.id,
        amountPaise: p.amount_paise,
        mode: chooseMode(p.amount_paise, Boolean(d.account_number_enc), rtgsMinPaise),
        beneficiary: {
          ref: d.id,
          name: d.account_holder_name || p.vendors?.display_name || "Vendor",
          accountNumber: d.account_number_enc ? decrypt(d.account_number_enc) : null,
          ifsc: d.ifsc,
          upiId: d.upi_id,
          email: p.vendors?.email,
          phone: p.vendors?.phone,
        },
        cached: ver.refs?.[rail.id] ?? null,
        narration: `TArrow ${p.remarks ?? ""}`,
      });
      created++;
      await db.from("run_payments").update({ provider_payout_id: res.providerPayoutId, provider_status: res.providerStatus ?? null }).eq("id", p.id);
      if (res.refs) await db.from("vendor_bank_details").update({ verification: { ...ver, refs: { ...(ver.refs ?? {}), [rail.id]: res.refs } } as unknown as Json }).eq("id", d.id);
      await db.from("activity_log").insert({ workspace_id: workspaceId, action: "payout.sent", entity_type: "run_payment", entity_id: p.id, details: { provider: rail.id, amount_paise: p.amount_paise, test_mode: true } });
      const outcome = mapResultToOutcome(res);
      if (outcome.kind !== "processing") await applyPaymentOutcome(db, p.id, outcome);
    } catch (e) {
      if (e instanceof RailError && (e.code === "VALIDATION" || e.code === "INSUFFICIENT_BALANCE" || e.code === "AUTH")) {
        // Definitely not created → release the claim so the owner can retry.
        await db.from("run_payments").update({ status: "pending", provider: null, sent_at: null }).eq("id", p.id).eq("status", "processing");
        if (e.code === "INSUFFICIENT_BALANCE") return { ok: false, error: "INSUFFICIENT_BALANCE" };
        return { ok: false, error: "PROVIDER", message: e.message };
      }
      // Network/unknown: the payout may exist — keep "processing"; polling resolves it by reference.
    }
  }
  return { ok: true, created, needsOverride };
}

/** Polling fallback for in-flight payouts of a run. */
export async function refreshRunPayouts(workspaceId: string, runId: string) {
  const db = createAdminClient();
  const { data: prov } = await db.from("payout_providers").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (!prov) return;
  const rail = railFor(prov as ProviderRow);
  const { data: pays } = await db
    .from("run_payments")
    .select("id, provider_payout_id, provider_status, sent_at, provider")
    .eq("run_id", runId)
    .eq("workspace_id", workspaceId)
    .eq("method", "direct")
    .in("status", ["processing", "sent"]);
  for (const p of pays ?? []) {
    if (p.provider && p.provider !== rail.id) continue;
    try {
      let res = await rail.getPayout({ providerPayoutId: p.provider_payout_id, referenceId: p.id, createdAt: p.sent_at ?? undefined });
      if (res && rail.id === "simulated" && p.provider_status === "will_fail" && res.status === "processed") {
        res = { ...res, status: "failed", utr: null, failureReason: "Simulated failure: beneficiary bank declined" };
      }
      if (!res) continue;
      const outcome = mapResultToOutcome(res);
      if (outcome.kind !== "processing") await applyPaymentOutcome(db, p.id, outcome);
    } catch {
      /* try again on the next poll */
    }
  }
}
