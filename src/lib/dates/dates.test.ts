import { describe, expect, it } from "vitest";
import { addDays, computeDueDate, parseIndianDate, todayIst } from ".";

describe("parseIndianDate", () => {
  it.each([
    ["05/03/2025", "2025-03-05"],
    ["5-3-25", "2025-03-05"],
    ["05.03.2025", "2025-03-05"],
    ["2025-03-05", "2025-03-05"],
    ["5 Mar 2025", "2025-03-05"],
    ["05-Mar-25", "2025-03-05"],
    ["March 5, 2025", "2025-03-05"],
    ["1st April 2025", "2025-04-01"],
  ])("%s → %s", (input, out) => expect(parseIndianDate(input)).toBe(out));
  it("rejects impossible dates", () => {
    expect(parseIndianDate("31/02/2025")).toBeNull();
    expect(parseIndianDate("hello")).toBeNull();
  });
  it("reads Excel serials", () => expect(parseIndianDate(45721)).toBe("2025-03-05"));
});

describe("due date", () => {
  it("prefers the printed due date", () => {
    expect(computeDueDate({ printedDueDate: "2025-04-10", invoiceDate: "2025-03-01", creditDays: 30 })).toBe("2025-04-10");
  });
  it("adds credit days otherwise", () => {
    expect(computeDueDate({ invoiceDate: "2025-01-15", creditDays: 30 })).toBe("2025-02-14");
    expect(computeDueDate({ invoiceDate: "2024-02-15", creditDays: 15 })).toBe("2024-03-01");
  });
  it("returns null without an invoice date", () => expect(computeDueDate({ creditDays: 30 })).toBeNull());
  it("addDays crosses years", () => expect(addDays("2024-12-25", 10)).toBe("2025-01-04"));
  it("todayIst rolls over at IST midnight", () => {
    expect(todayIst(new Date("2025-03-04T19:00:00Z"))).toBe("2025-03-05");
  });
});
