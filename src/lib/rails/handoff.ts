import type { PaymentRail } from "./types";
import { generateBankFile, type BankFileInput } from "@/lib/bankfile";
import { upiDeepLink } from "@/lib/payments";

/** Bank bulk file: the owner uploads the generated file in their own net banking (one OTP). */
export const bankFileRail = {
  id: "bank_file",
  kind: "handoff",
  testMode: false,
  generate: (input: BankFileInput) => generateBankFile(input),
} satisfies PaymentRail & { generate: typeof generateBankFile };

/** UPI handoff: opens the owner's UPI app with the details pre-filled. */
export const upiRail = {
  id: "upi",
  kind: "handoff",
  testMode: false,
  link: upiDeepLink,
} satisfies PaymentRail & { link: typeof upiDeepLink };
