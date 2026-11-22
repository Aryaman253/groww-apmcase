import "server-only";
import { decrypt } from "@/lib/crypto";
import { razorpayx } from "./razorpayx";
import { cashfree } from "./cashfree";
import { simulated } from "./simulated";
import type { PayoutRail } from "./types";

export * from "./types";
export { isDirectPayEnabled } from "./config";

export type ProviderRow = {
  provider: "razorpayx" | "cashfree" | "simulated";
  credentials_enc: string | null;
  account_number: string | null;
  uses_app_demo_keys: boolean;
};

type Creds = { keyId?: string; keySecret?: string; clientId?: string; clientSecret?: string; webhookSecret?: string };

export function providerCreds(row: ProviderRow): Creds {
  if (row.uses_app_demo_keys) {
    if (row.provider === "razorpayx")
      return { keyId: process.env.RAZORPAYX_KEY_ID, keySecret: process.env.RAZORPAYX_KEY_SECRET, webhookSecret: process.env.RAZORPAYX_WEBHOOK_SECRET };
    if (row.provider === "cashfree")
      return { clientId: process.env.CASHFREE_CLIENT_ID, clientSecret: process.env.CASHFREE_CLIENT_SECRET, webhookSecret: process.env.CASHFREE_WEBHOOK_SECRET };
    return { webhookSecret: process.env.SIMULATED_RAIL_SECRET };
  }
  if (row.provider === "simulated") return { webhookSecret: process.env.SIMULATED_RAIL_SECRET };
  return row.credentials_enc ? (JSON.parse(decrypt(row.credentials_enc)) as Creds) : {};
}

/** Builds the payout rail for a workspace's connected provider. Test keys only. */
export function railFor(row: ProviderRow): PayoutRail {
  const c = providerCreds(row);
  if (row.provider === "razorpayx") {
    const accountNumber = row.uses_app_demo_keys ? process.env.RAZORPAYX_ACCOUNT_NUMBER : row.account_number;
    if (!c.keyId || !c.keySecret || !accountNumber) throw new Error("RazorpayX is not configured");
    if (!c.keyId.startsWith("rzp_test_")) throw new Error("Only RazorpayX test keys are allowed in this build");
    return razorpayx({ keyId: c.keyId, keySecret: c.keySecret, accountNumber });
  }
  if (row.provider === "cashfree") {
    if (!c.clientId || !c.clientSecret) throw new Error("Cashfree is not configured");
    return cashfree({ clientId: c.clientId, clientSecret: c.clientSecret });
  }
  return simulated();
}
