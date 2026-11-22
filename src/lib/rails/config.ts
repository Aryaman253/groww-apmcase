/** Feature flag: Direct pay through a payout provider (test mode only in this build). */
export function isDirectPayEnabled(): boolean {
  const v = process.env.DIRECT_PAY_ENABLED;
  return v === undefined ? true : v === "true" || v === "1";
}
