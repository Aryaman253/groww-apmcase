import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

describe("direct pay helpers", async () => {
  const { chooseMode, mapResultToOutcome } = await import("./direct-pay");
  it("chooses UPI for UPI-only, RTGS at/above the threshold, IMPS below", () => {
    expect(chooseMode(50000, false)).toBe("UPI");
    expect(chooseMode(2_00_000_00, true)).toBe("RTGS");
    expect(chooseMode(1_99_999_99, true)).toBe("IMPS");
    expect(chooseMode(60_000_00, true, 50_000_00)).toBe("RTGS");
  });
  it("maps provider results to outcomes; processed without UTR is not 'paid'", () => {
    expect(mapResultToOutcome({ status: "processed", utr: "U1" })).toEqual({ kind: "paid", utr: "U1" });
    expect(mapResultToOutcome({ status: "processed", utr: null }).kind).toBe("processing");
    expect(mapResultToOutcome({ status: "failed", failureReason: "x" })).toEqual({ kind: "failed", reason: "x" });
    expect(mapResultToOutcome({ status: "reversed" }).kind).toBe("reversed");
  });
});
