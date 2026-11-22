/**
 * Amount in words, Indian numbering system (thousand, lakh, crore).
 *
 *   amountInWords(12345650, "en")
 *   → "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only"
 *   amountInWords(12345650, "hi")
 *   → "एक लाख तेईस हज़ार चार सौ छप्पन रुपये और पचास पैसे मात्र"
 *
 * Input is integer paise. Amounts of 100 crore and above are expressed as
 * "<n> Crore" with n itself spelled out recursively ("One Thousand Crore"),
 * which is how Indian cheques/bank letters usually read (no arab/kharab).
 */

export type AmountWordsLang = "en" | "hi";

/** Largest supported amount: ₹99,99,99,99,99,999.99 (well within 2^53 paise). */
export const AMOUNT_WORDS_MAX_PAISE = 9_999_999_999_999_99;

const EN_ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function en99(n: number): string {
  if (n < 20) return EN_ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${EN_TENS[t]}-${EN_ONES[o]}` : EN_TENS[t];
}

/**
 * Hindi number words 0–99. These are irregular and must be listed in full.
 * Spellings follow standard Hindi (e.g. पाँच, छह, उनचास, उन्यासी, नवासी).
 */
const HI_0_99: readonly string[] = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
].map((w) => w.normalize("NFC"));

interface Scale {
  value: number;
  en: string;
  hi: string;
}
const SCALES: Scale[] = [
  { value: 10_000_000, en: "Crore", hi: "करोड़" },
  { value: 100_000, en: "Lakh", hi: "लाख" },
  { value: 1_000, en: "Thousand", hi: "हज़ार" },
  { value: 100, en: "Hundred", hi: "सौ" },
];

/** Spells a non-negative integer in the Indian system. 0 → "" (caller handles zero). */
function spell(n: number, lang: AmountWordsLang): string[] {
  const words: string[] = [];
  let rest = n;
  for (const scale of SCALES) {
    if (rest >= scale.value) {
      const q = Math.floor(rest / scale.value);
      rest %= scale.value;
      // Crore multiplier may itself exceed 99 → recurse.
      words.push(...spell(q, lang), lang === "en" ? scale.en : scale.hi);
    }
  }
  if (rest > 0) words.push(lang === "en" ? en99(rest) : HI_0_99[rest]);
  return words;
}

/** Spells a non-negative integer, e.g. numberInWords(123456, "en") → "One Lakh Twenty-Three Thousand Four Hundred Fifty-Six". */
export function numberInWords(n: number, lang: AmountWordsLang): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("numberInWords: expected a non-negative integer");
  if (n === 0) return lang === "en" ? EN_ONES[0] : HI_0_99[0];
  return spell(n, lang).join(" ").normalize("NFC");
}

/**
 * Amount (integer paise) in words.
 * - 0 → "Rupees Zero Only" / "शून्य रुपये मात्र"
 * - paise only → "Fifty Paise Only" / "पचास पैसे मात्र"
 * Throws RangeError for negative, non-integer or out-of-range input.
 */
export function amountInWords(paise: number, lang: AmountWordsLang = "en"): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError("amountInWords: paise must be a non-negative integer");
  }
  if (paise > AMOUNT_WORDS_MAX_PAISE) throw new RangeError("amountInWords: amount too large");
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;

  if (lang === "en") {
    const paiseWord = p === 1 ? "Paisa" : "Paise";
    if (rupees === 0 && p === 0) return "Rupees Zero Only";
    if (rupees === 0) return `${en99(p)} ${paiseWord} Only`;
    const r = `Rupees ${numberInWords(rupees, "en")}`;
    return p ? `${r} and ${en99(p)} ${paiseWord} Only` : `${r} Only`;
  }

  const rupeeWord = rupees === 1 ? "रुपया" : "रुपये";
  const paiseWord = p === 1 ? "पैसा" : "पैसे";
  let out: string;
  if (rupees === 0 && p === 0) out = `${HI_0_99[0]} रुपये मात्र`;
  else if (rupees === 0) out = `${HI_0_99[p]} ${paiseWord} मात्र`;
  else {
    const r = `${numberInWords(rupees, "hi")} ${rupeeWord}`;
    out = p ? `${r} और ${HI_0_99[p]} ${paiseWord} मात्र` : `${r} मात्र`;
  }
  return out.normalize("NFC");
}
