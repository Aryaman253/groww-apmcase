import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { razorpayx } from "./razorpayx";
import { cashfree } from "./cashfree";
import { simulated, simulatedUtr } from "./simulated";
import { directPayIdempotencyKey } from "@/lib/payments";

const h = (o: Record<string, string>) => new Headers(o);

describe("webhook signature verification", () => {
  const body = JSON.stringify({ event: "payout.processed", payload: { payout: { entity: { id: "pout_1", status: "processed", utr: "UTR123", reference_id: "11111111-1111-1111-1111-111111111111" } } } });
  const rzp = razorpayx({ keyId: "rzp_test_x", keySecret: "s", accountNumber: "1" });

  it("RazorpayX: accepts a valid HMAC-SHA256 hex signature", () => {
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(rzp.verifyWebhook(body, h({ "x-razorpay-signature": sig }), "whsec")).toBe(true);
  });
  it("RazorpayX: rejects a wrong secret, tampered body or missing header", () => {
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(rzp.verifyWebhook(body, h({ "x-razorpay-signature": sig }), "other")).toBe(false);
    expect(rzp.verifyWebhook(body.replace("UTR123", "UTR999"), h({ "x-razorpay-signature": sig }), "whsec")).toBe(false);
    expect(rzp.verifyWebhook(body, h({}), "whsec")).toBe(false);
  });
  it("RazorpayX: parses payout events", () => {
    const e = rzp.parseWebhook(body, h({ "x-razorpay-event-id": "evt_1" }))!;
    expect(e).toMatchObject({ eventId: "evt_1", status: "processed", utr: "UTR123", referenceId: "11111111-1111-1111-1111-111111111111" });
    const failed = rzp.parseWebhook(body.replace('"processed"', '"reversed"'), h({}))!;
    expect(failed.status).toBe("reversed");
  });
  it("Cashfree: timestamp + body, base64", () => {
    const cf = cashfree({ clientId: "a", clientSecret: "b" });
    const ts = "1700000000";
    const sig = createHmac("sha256", "sec").update(ts + body).digest("base64");
    expect(cf.verifyWebhook(body, h({ "x-webhook-signature": sig, "x-webhook-timestamp": ts }), "sec")).toBe(true);
    expect(cf.verifyWebhook(body, h({ "x-webhook-signature": sig, "x-webhook-timestamp": "1" }), "sec")).toBe(false);
  });
  it("Simulated rail: signed events only", () => {
    const sim = simulated();
    const b = JSON.stringify({ reference_id: "r1", status: "failed", reason: "x" });
    const sig = createHmac("sha256", "s").update(b).digest("hex");
    expect(sim.verifyWebhook(b, h({ "x-simulated-signature": sig }), "s")).toBe(true);
    expect(sim.verifyWebhook(b, h({ "x-simulated-signature": "00" }), "s")).toBe(false);
    expect(sim.parseWebhook(b, h({}))).toMatchObject({ status: "failed", failureReason: "x", utr: null });
  });
});

describe("idempotent Direct pay transfer ids", () => {
  it("same run payment → same key; different payment → different key", () => {
    const a = "6f9c2f8e-1d2b-4c1e-9f1a-1b2c3d4e5f60";
    expect(directPayIdempotencyKey(a)).toBe(directPayIdempotencyKey(a));
    expect(directPayIdempotencyKey(a)).not.toBe(directPayIdempotencyKey("6f9c2f8e-1d2b-4c1e-9f1a-1b2c3d4e5f61"));
  });
  it("simulated payout ids derive from the idempotency key (double taps collapse)", async () => {
    const sim = simulated();
    const req = { idempotencyKey: "tarrow-x", referenceId: "x", amountPaise: 100, mode: "IMPS" as const, beneficiary: { ref: "b", name: "n", accountNumber: "123456789", ifsc: "ABCD0001234" }, narration: "n" };
    const [p1, p2] = await Promise.all([sim.createPayout(req), sim.createPayout(req)]);
    expect(p1.providerPayoutId).toBe(p2.providerPayoutId);
    expect(simulatedUtr("x")).toBe(simulatedUtr("x"));
  });
});
