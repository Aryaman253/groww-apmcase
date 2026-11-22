"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, sha256 } from "@/lib/crypto";
import { bankDetailsSchema } from "@/lib/schemas";
import { last4 } from "@/lib/validation";

const inputSchema = z.object({
  token: z.string().min(20).max(64),
  name: z.string().trim().max(120).optional(),
  consent: z.literal(true),
  bank: bankDetailsSchema,
});

/** Public, unauthenticated: rate-limited, single-use, expiring. Creates a PENDING version only. */
export async function submitVendorDetails(input: z.input<typeof inputSchema>): Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const db = createAdminClient();
  const { data: allowed } = await db.rpc("hit_rate_limit", { p_key: `vreq:${sha256(ip)}`, p_max: 10, p_window_seconds: 600 });
  if (allowed === false) return { ok: false, error: "RATE_LIMITED" };

  const parsed = inputSchema.safeParse({ ...input, bank: { ...input.bank, requireConfirm: true } });
  if (!parsed.success) {
    return { ok: false, error: "INVALID", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.slice(-1).join("."), i.message])) };
  }
  const b = parsed.data.bank;
  if (!b.accountNumber && !b.upiId) return { ok: false, error: "INVALID", fieldErrors: { accountNumber: "accountOrUpi" } };

  const { data: req } = await db
    .from("vendor_requests")
    .select("id, workspace_id, vendor_id, expires_at, used_at")
    .eq("token_hash", sha256(parsed.data.token))
    .maybeSingle();
  if (!req || req.used_at || new Date(req.expires_at) < new Date()) return { ok: false, error: "INVALID_LINK" };

  // Claim the token first so it can't be used twice concurrently.
  const { data: claimed } = await db
    .from("vendor_requests")
    .update({ used_at: new Date().toISOString() })
    .eq("id", req.id)
    .is("used_at", null)
    .select("id");
  if (!claimed?.length) return { ok: false, error: "INVALID_LINK" };

  let vendorId = req.vendor_id;
  if (!vendorId) {
    const name = parsed.data.name || b.accountHolderName || "New vendor";
    const { data: v, error } = await db.from("vendors").insert({ workspace_id: req.workspace_id, display_name: name }).select("id").single();
    if (error || !v) return { ok: false, error: "DB" };
    vendorId = v.id;
  }
  const { data: prev } = await db.from("vendor_bank_details").select("account_last4, ifsc, upi_id").eq("vendor_id", vendorId).eq("status", "approved").maybeSingle();
  const { error } = await db.from("vendor_bank_details").insert({
    workspace_id: req.workspace_id,
    vendor_id: vendorId,
    version: 0,
    account_holder_name: b.accountHolderName ?? null,
    account_number_enc: b.accountNumber ? encrypt(b.accountNumber) : null,
    account_last4: b.accountNumber ? last4(b.accountNumber) : null,
    ifsc: b.ifsc ?? null,
    bank_name: b.bankName ?? null,
    branch: b.branch ?? null,
    upi_id: b.upiId ?? null,
    status: "pending",
    source: "vendor_link",
    created_by: null,
  });
  if (error) return { ok: false, error: "DB" };
  await db.from("activity_log").insert({
    workspace_id: req.workspace_id,
    actor_id: null,
    action: "bank_details.changed",
    entity_type: "vendor",
    entity_id: vendorId,
    details: {
      source: "vendor_link",
      old_last4: prev?.account_last4 ?? null,
      new_last4: b.accountNumber ? last4(b.accountNumber) : null,
      old_ifsc: prev?.ifsc ?? null,
      new_ifsc: b.ifsc ?? null,
    },
  });
  await db.from("activity_log").insert({ workspace_id: req.workspace_id, actor_id: null, action: "vendor_request.submitted", entity_type: "vendor", entity_id: vendorId, details: {} });
  return { ok: true };
}
