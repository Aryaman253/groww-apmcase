import { describe, expect, it } from "vitest";
import { AMOUNT_WORDS_MAX_PAISE, amountInWords, numberInWords } from ".";

const nfc = (s: string) => s.normalize("NFC");

describe("amountInWords — English", () => {
  it("formats the canonical example", () => {
    expect(amountInWords(12345650, "en")).toBe(
      "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only",
    );
  });
  it("defaults to English", () => {
    expect(amountInWords(100)).toBe("Rupees One Only");
  });
  it("handles zero and paise-only", () => {
    expect(amountInWords(0, "en")).toBe("Rupees Zero Only");
    expect(amountInWords(50, "en")).toBe("Fifty Paise Only");
    expect(amountInWords(1, "en")).toBe("One Paisa Only");
    expect(amountInWords(99, "en")).toBe("Ninety-Nine Paise Only");
  });
  it("handles round numbers", () => {
    expect(amountInWords(1000_00, "en")).toBe("Rupees One Thousand Only");
    expect(amountInWords(1_00_000_00, "en")).toBe("Rupees One Lakh Only");
    expect(amountInWords(1_00_00_000_00, "en")).toBe("Rupees One Crore Only");
    expect(amountInWords(10_00_000_00, "en")).toBe("Rupees Ten Lakh Only");
    expect(amountInWords(2_00_000_00, "en")).toBe("Rupees Two Lakh Only");
  });
  it("handles teens, tens and hyphenation", () => {
    expect(amountInWords(1100, "en")).toBe("Rupees Eleven Only");
    expect(amountInWords(1900, "en")).toBe("Rupees Nineteen Only");
    expect(amountInWords(2000, "en")).toBe("Rupees Twenty Only");
    expect(amountInWords(2100, "en")).toBe("Rupees Twenty-One Only");
    expect(amountInWords(10100, "en")).toBe("Rupees One Hundred One Only");
    expect(amountInWords(100500, "en")).toBe("Rupees One Thousand Five Only");
    expect(amountInWords(1_01_000_00, "en")).toBe("Rupees One Lakh One Thousand Only");
  });
  it("handles crore scale and beyond 99 crore", () => {
    expect(amountInWords(99_99_99_99_999_00, "en")).toBe(
      "Rupees Nine Thousand Nine Hundred Ninety-Nine Crore Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine Only",
    );
    expect(amountInWords(12_34_56_78_901_23, "en")).toBe(
      "Rupees One Thousand Two Hundred Thirty-Four Crore Fifty-Six Lakh Seventy-Eight Thousand Nine Hundred One and Twenty-Three Paise Only",
    );
    expect(amountInWords(AMOUNT_WORDS_MAX_PAISE, "en")).toMatch(/^Rupees Nine Lakh Ninety-Nine Thousand .* Crore .* and Ninety-Nine Paise Only$/);
  });
  it("rejects invalid input", () => {
    expect(() => amountInWords(-1, "en")).toThrow(RangeError);
    expect(() => amountInWords(1.5, "en")).toThrow(RangeError);
    expect(() => amountInWords(Number.NaN, "en")).toThrow(RangeError);
    expect(() => amountInWords(AMOUNT_WORDS_MAX_PAISE + 1, "en")).toThrow(RangeError);
  });
});

describe("amountInWords — Hindi", () => {
  it("formats the canonical example", () => {
    expect(amountInWords(12345650, "hi")).toBe(nfc("एक लाख तेईस हज़ार चार सौ छप्पन रुपये और पचास पैसे मात्र"));
  });
  it("handles zero, singular and paise-only", () => {
    expect(amountInWords(0, "hi")).toBe(nfc("शून्य रुपये मात्र"));
    expect(amountInWords(100, "hi")).toBe(nfc("एक रुपया मात्र"));
    expect(amountInWords(1, "hi")).toBe(nfc("एक पैसा मात्र"));
    expect(amountInWords(75, "hi")).toBe(nfc("पचहत्तर पैसे मात्र"));
  });
  it("handles crore and lakh", () => {
    expect(amountInWords(2_50_00_000_00, "hi")).toBe(nfc("दो करोड़ पचास लाख रुपये मात्र"));
    expect(amountInWords(1000_00_00_000_00, "hi")).toBe(nfc("एक हज़ार करोड़ रुपये मात्र"));
    expect(amountInWords(99_99_99_99_999_00, "hi")).toBe(
      nfc("नौ हज़ार नौ सौ निन्यानवे करोड़ निन्यानवे लाख निन्यानवे हज़ार नौ सौ निन्यानवे रुपये मात्र"),
    );
  });

  it("spells every number 1–99 correctly", () => {
    const expected = [
      "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस",
      "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस",
      "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस",
      "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस", "चालीस",
      "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
      "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ", "साठ",
      "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर",
      "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी", "अस्सी",
      "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी", "नब्बे",
      "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
    ];
    expect(expected).toHaveLength(99);
    for (let n = 1; n <= 99; n++) {
      expect(numberInWords(n, "hi"), `n=${n}`).toBe(nfc(expected[n - 1]));
    }
    // All distinct (catches copy-paste slips).
    expect(new Set(expected).size).toBe(99);
  });

  it("output is NFC-normalised (nukta letters are stable)", () => {
    const s = amountInWords(1_38_000_00, "hi");
    expect(s).toBe(s.normalize("NFC"));
    expect(s).toBe(nfc("एक लाख अड़तीस हज़ार रुपये मात्र"));
  });
});

describe("numberInWords", () => {
  it("spells zero and English 1–99 boundaries", () => {
    expect(numberInWords(0, "en")).toBe("Zero");
    expect(numberInWords(0, "hi")).toBe(nfc("शून्य"));
    expect(numberInWords(40, "en")).toBe("Forty");
    expect(numberInWords(99, "en")).toBe("Ninety-Nine");
    expect(numberInWords(100, "en")).toBe("One Hundred");
    expect(numberInWords(999, "en")).toBe("Nine Hundred Ninety-Nine");
    expect(numberInWords(100000, "hi")).toBe(nfc("एक लाख"));
  });
});
