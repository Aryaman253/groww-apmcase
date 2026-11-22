import { describe, expect, it } from "vitest";
import {
  gstinCheckChar,
  isValidAccountNumber,
  isValidGstin,
  isValidIfsc,
  isValidUpi,
  nameMatchScore,
  namesReasonablyMatch,
} from ".";

describe("IFSC", () => {
  it("accepts valid codes", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("sbin0000300")).toBe(true);
    expect(isValidIfsc("ICIC0ABC123")).toBe(true);
  });
  it("rejects invalid codes", () => {
    expect(isValidIfsc("HDFC1001234")).toBe(false);
    expect(isValidIfsc("HDF00001234")).toBe(false);
    expect(isValidIfsc("HDFC000123")).toBe(false);
  });
});

describe("account number", () => {
  it("accepts 9–18 digits, with spaces", () => {
    expect(isValidAccountNumber("123456789")).toBe(true);
    expect(isValidAccountNumber("1234 5678 9012 3456")).toBe(true);
    expect(isValidAccountNumber("123456789012345678")).toBe(true);
  });
  it("rejects too short/long or non-digits", () => {
    expect(isValidAccountNumber("12345678")).toBe(false);
    expect(isValidAccountNumber("1234567890123456789")).toBe(false);
    expect(isValidAccountNumber("12345678A")).toBe(false);
  });
});

describe("GSTIN", () => {
  const base = "27AAPFU0939F1Z";
  it("computes the checksum", () => {
    expect(gstinCheckChar(base)).toBe("V");
    expect(isValidGstin(base + "V")).toBe(true);
  });
  it("rejects a wrong check character", () => {
    expect(isValidGstin(base + "A")).toBe(false);
  });
  it("rejects bad format and state code", () => {
    expect(isValidGstin("27AAPFU0939F1V")).toBe(false);
    const bad = "00AAPFU0939F1Z";
    expect(isValidGstin(bad + gstinCheckChar(bad))).toBe(false);
  });
});

describe("UPI", () => {
  it("accepts handles", () => {
    expect(isValidUpi("rkpharma@okicici")).toBe(true);
    expect(isValidUpi("9876543210@ybl")).toBe(true);
    expect(isValidUpi("shop.name-1@paytm")).toBe(true);
  });
  it("rejects malformed ids", () => {
    expect(isValidUpi("no-at-sign")).toBe(false);
    expect(isValidUpi("a@")).toBe(false);
    expect(isValidUpi("x@1bank")).toBe(false);
  });
});

describe("name match", () => {
  it("matches same names ignoring suffixes", () => {
    expect(namesReasonablyMatch("Shree Ganesh Medical Agencies", "SHREE GANESH MEDICAL AGENCIES PVT LTD")).toBe(true);
  });
  it("flags clearly different names", () => {
    expect(nameMatchScore("Sunrise Distributors", "Ramesh Kumar")).toBeLessThan(0.5);
  });
});
