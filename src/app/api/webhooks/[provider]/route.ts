import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { railFor, providerCreds, type ProviderRow } from "@/lib/rails";
import { razorpayx } from "@/lib/rails/razorpayx";
import { cashfree } from "@/lib/rails/cashfree";
import { simulated } from "@/lib/rails/simulated";
import { applyPaymentOutcome } from "@/lib/server/runs";
import { mapResultToOutcome } from "@/lib/server/direct-pay";
import type { Json } from "@/lib/supabase/database.types";

const PARSERS = {
  razorpayx: () => razorpayx({ keyId: "x", keySecret: "x", accountNumber: "x" }),
  cashfree: () => cashfree({ clientId: "x", clientSecret: "x" }),
  simulated: () => simulated(),
} as const;

/**
 * Payout status webhooks. The signature is verified with the webhook secret of the
 * workspace that owns the referenced payment (or the app's demo secret). Events are
 * stored once (provider + event id) so redeliveries are no-ops.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!(provider in PARSERS)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const parser = PARSERS[provider as keyof typeof PARSERS]();
  let event;
  try {
    event = parser.parseWebhook(raw, req.headers);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  if (!event?.referenceId || !/^[0-9a-f-]{36}$/i.test(event.referenceId)) return NextResponse.json({ ok: true, ignored: true });

  const db = createAdminClient();
  const { data: pay } = await db.from("run_payments").select("id, workspace_id, method").eq("id", event.referenceId).maybeSingle();
  if (!pay || pay.method !== "direct") return NextResponse.json({ ok: true, ignored: true });
  const { data: prov } = await db.from("payout_providers").select("*").eq("workspace_id", pay.workspace_id).maybeSingle();
  if (!prov || prov.provider !== provider) return NextResponse.json({ error: "provider mismatch" }, { status: 401 });
  const secret = providerCreds(prov as ProviderRow).webhookSecret;
  if (!secret || !railFor(prov as ProviderRow).verifyWebhook(raw, req.headers, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const { error: dupErr } = await db
    .from("payout_events")
    .insert({ provider, event_id: event.eventId, run_payment_id: pay.id, payload: JSON.parse(raw) as Json });
  if (dupErr) return NextResponse.json({ ok: true, duplicate: true });

  if (event.providerPayoutId) await db.from("run_payments").update({ provider_payout_id: event.providerPayoutId }).eq("id", pay.id).is("provider_payout_id", null);
  if (event.status) {
    const outcome = mapResultToOutcome({ status: event.status, utr: event.utr, failureReason: event.failureReason });
    try {
      await applyPaymentOutcome(db, pay.id, outcome);
      if (outcome.kind === "paid" || outcome.kind === "failed" || outcome.kind === "reversed") {
        await db.from("activity_log").insert({
          workspace_id: pay.workspace_id,
          action: outcome.kind === "paid" ? "utr.recorded" : "payment.failed",
          entity_type: "run_payment",
          entity_id: pay.id,
          details: outcome.kind === "paid" ? { utr: outcome.utr, source: `webhook:${provider}` } : { reason: outcome.reason, source: `webhook:${provider}` },
        });
      }
    } catch {
      /* e.g. "paid" after "failed": ignore out-of-order events */
    }
  }
  return NextResponse.json({ ok: true });
}
