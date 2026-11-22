import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto", () => {
  it("round-trips and never contains the plaintext", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const enc = encrypt("123456789012");
    expect(enc).not.toContain("123456789012");
    expect(decrypt(enc)).toBe("123456789012");
    expect(encrypt("123456789012")).not.toBe(enc);
  });
  it("detects tampering", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const enc = encrypt("999999999");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
