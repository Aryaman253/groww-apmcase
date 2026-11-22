/**
 * "Rupees Eleven Thousand Eight Hundred and Fifty Paise Only" → paise.
 * Indian (lakh/crore) and international (million) scales. Used only to
 * corroborate a printed total, never as the sole source of a confident value.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, million: 1e6, crore: 1e7, crores: 1e7,
};

function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w === "and" || w === "") continue;
    if (w in UNITS) {
      current += UNITS[w];
      seen = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (w in SCALES) {
      total += (current || 1) * SCALES[w];
      current = 0;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + current : null;
}

const WORD = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|fou?rty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lacs?|million|crores?|and";
const PHRASE = new RegExp(`(?:^|[^a-z])((?:(?:${WORD})[\\s,-]+)*(?:${WORD}))(?:[\\s,-]+(?:rupees?|rs\\.?))?(?:[\\s,-]+and[\\s,-]+((?:(?:${WORD})[\\s,-]+)*(?:${WORD}))[\\s,-]+paise)?[\\s,.-]*only`, "i");

/** Parses an amount-in-words phrase ending in "only". Returns paise or null. */
export function amountWordsToPaise(text: string): number | null {
  const m = text.toLowerCase().match(PHRASE);
  if (!m) return null;
  const split = (s: string) => s.split(/[\s,-]+/);
  const rupeeWords = split(m[1]);
  // Drop a trailing "and" that belonged to the paise clause.
  while (rupeeWords.length && rupeeWords[rupeeWords.length - 1] === "and") rupeeWords.pop();
  const rupees = wordsToNumber(rupeeWords);
  if (rupees === null || rupees === 0) return null;
  const paise = m[2] ? wordsToNumber(split(m[2])) : 0;
  if (paise === null || paise > 99) return null;
  return rupees * 100 + paise;
}
