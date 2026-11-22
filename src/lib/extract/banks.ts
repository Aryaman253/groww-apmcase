/**
 * IFSC bank prefixes → canonical bank names, plus textual aliases (English,
 * Hindi, abbreviations) used to recognise a bank mentioned in free text.
 */

export const IFSC_BANKS: Record<string, string> = {
  SBIN: "State Bank of India",
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  UTIB: "Axis Bank",
  KKBK: "Kotak Mahindra Bank",
  PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  YESB: "Yes Bank",
  INDB: "IndusInd Bank",
  IDFB: "IDFC FIRST Bank",
  FDRL: "Federal Bank",
  IDIB: "Indian Bank",
  BKID: "Bank of India",
  CBIN: "Central Bank of India",
  IOBA: "Indian Overseas Bank",
  UCBA: "UCO Bank",
  MAHB: "Bank of Maharashtra",
  PSIB: "Punjab & Sind Bank",
  IBKL: "IDBI Bank",
  KARB: "Karnataka Bank",
  KVBL: "Karur Vysya Bank",
  SIBL: "South Indian Bank",
  RATN: "RBL Bank",
  AUBL: "AU Small Finance Bank",
  BDBL: "Bandhan Bank",
  DBSS: "DBS Bank India",
  CIUB: "City Union Bank",
  TMBL: "Tamilnad Mercantile Bank",
  JAKA: "Jammu & Kashmir Bank",
  DLXB: "Dhanlaxmi Bank",
  CSBK: "CSB Bank",
  ESFB: "Equitas Small Finance Bank",
  UJVN: "Ujjivan Small Finance Bank",
  PYTM: "Paytm Payments Bank",
  AIRP: "Airtel Payments Bank",
  IPOS: "India Post Payments Bank",
  SCBL: "Standard Chartered Bank",
  HSBC: "HSBC",
  CITI: "Citibank",
  DEUT: "Deutsche Bank",
  SRCB: "Saraswat Bank",
  COSB: "Cosmos Bank",
  SVCB: "SVC Co-operative Bank",
  NKGS: "NKGSB Co-operative Bank",
  TJSB: "TJSB Sahakari Bank",
  ABHY: "Abhyudaya Co-operative Bank",
  KAIJ: "Kallappanna Awade Ichalkaranji Janata Sahakari Bank",
  ESMF: "ESAF Small Finance Bank",
  FINO: "Fino Payments Bank",
  JSFB: "Jana Small Finance Bank",
  SURY: "Suryoday Small Finance Bank",
  NESF: "North East Small Finance Bank",
  UTKS: "Utkarsh Small Finance Bank",
};

/** Alias regex source (case-insensitive) → canonical name. Longest match wins. */
const ALIASES: [string, string][] = [
  ["state\\s+bank\\s+of\\s+india|sbi|भारतीय\\s+स्टेट\\s+बैंक|स्टेट\\s+बैंक(?:\\s+ऑफ\\s+इंडिया)?|एसबीआई", "State Bank of India"],
  ["hdfc(?:\\s+bank)?|एचडीएफसी(?:\\s+बैंक)?", "HDFC Bank"],
  ["icici(?:\\s+bank)?|आईसीआईसीआई(?:\\s+बैंक)?", "ICICI Bank"],
  ["axis\\s+bank|एक्सिस\\s+बैंक", "Axis Bank"],
  ["kotak(?:\\s+mahindra)?(?:\\s+bank)?|कोटक(?:\\s+महिंद्रा)?(?:\\s+बैंक)?", "Kotak Mahindra Bank"],
  ["punjab\\s+national\\s+bank|pnb|पंजाब\\s+नेशनल\\s+बैंक", "Punjab National Bank"],
  ["bank\\s+of\\s+baroda|बैंक\\s+ऑफ\\s+बड़ौदा|बैंक\\s+ऑफ\\s+बडौदा", "Bank of Baroda"],
  ["canara\\s+bank|केनरा\\s+बैंक", "Canara Bank"],
  ["union\\s+bank(?:\\s+of\\s+india)?|यूनियन\\s+बैंक", "Union Bank of India"],
  ["yes\\s+bank|यस\\s+बैंक", "Yes Bank"],
  ["indusind(?:\\s+bank)?", "IndusInd Bank"],
  ["idfc(?:\\s+first)?(?:\\s+bank)?", "IDFC FIRST Bank"],
  ["federal\\s+bank", "Federal Bank"],
  ["indian\\s+overseas\\s+bank|iob", "Indian Overseas Bank"],
  ["indian\\s+bank|इंडियन\\s+बैंक", "Indian Bank"],
  ["central\\s+bank\\s+of\\s+india|सेंट्रल\\s+बैंक", "Central Bank of India"],
  ["bank\\s+of\\s+india|बैंक\\s+ऑफ\\s+इंडिया", "Bank of India"],
  ["uco\\s+bank|यूको\\s+बैंक", "UCO Bank"],
  ["bank\\s+of\\s+maharashtra|बैंक\\s+ऑफ\\s+महाराष्ट्र", "Bank of Maharashtra"],
  ["punjab\\s*(?:&|and)\\s*sind\\s+bank", "Punjab & Sind Bank"],
  ["idbi(?:\\s+bank)?", "IDBI Bank"],
  ["karnataka\\s+bank", "Karnataka Bank"],
  ["karur\\s+vysya\\s+bank|kvb", "Karur Vysya Bank"],
  ["south\\s+indian\\s+bank", "South Indian Bank"],
  ["rbl\\s+bank|ratnakar\\s+bank", "RBL Bank"],
  ["au\\s+small\\s+finance\\s+bank|au\\s+bank", "AU Small Finance Bank"],
  ["bandhan\\s+bank", "Bandhan Bank"],
  ["dbs\\s+bank", "DBS Bank India"],
  ["city\\s+union\\s+bank", "City Union Bank"],
  ["saraswat(?:\\s+co-?op(?:erative)?)?(?:\\s+bank)?", "Saraswat Bank"],
  ["cosmos(?:\\s+co-?op(?:erative)?)?\\s+bank", "Cosmos Bank"],
  ["paytm\\s+payments?\\s+bank", "Paytm Payments Bank"],
  ["airtel\\s+payments?\\s+bank", "Airtel Payments Bank"],
  ["india\\s+post\\s+payments?\\s+bank|ippb", "India Post Payments Bank"],
  ["standard\\s+chartered(?:\\s+bank)?", "Standard Chartered Bank"],
  ["citi\\s*bank", "Citibank"],
  ["hsbc", "HSBC"],
  ["equitas(?:\\s+small\\s+finance)?\\s+bank", "Equitas Small Finance Bank"],
  ["ujjivan(?:\\s+small\\s+finance)?\\s+bank", "Ujjivan Small Finance Bank"],
  ["j\\s*&\\s*k\\s+bank|jammu\\s*(?:&|and)\\s*kashmir\\s+bank", "Jammu & Kashmir Bank"],
];

const B = "(?<![\\p{L}\\p{N}\\p{M}@.])";
const E = "(?![\\p{L}\\p{N}\\p{M}])";
const ALIAS_RES: [RegExp, string][] = ALIASES.map(([src, name]) => [new RegExp(`${B}(?:${src})${E}`, "giu"), name]);

export interface BankMention {
  name: string;
  start: number;
  end: number;
}

/** Finds known bank names in a (masked) line; longest non-overlapping matches. */
export function findBankMentions(line: string): BankMention[] {
  const all: BankMention[] = [];
  for (const [re, name] of ALIAS_RES) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) all.push({ name, start: m.index, end: m.index + m[0].length });
  }
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const out: BankMention[] = [];
  for (const m of all) if (!out.some((o) => m.start < o.end && o.start < m.end)) out.push(m);
  return out.sort((a, b) => a.start - b.start);
}

export function bankFromIfsc(ifsc: string): string | null {
  return IFSC_BANKS[ifsc.slice(0, 4).toUpperCase()] ?? null;
}

export function canonicalBankName(text: string): string | null {
  const m = findBankMentions(text);
  return m.length === 1 ? m[0].name : null;
}

/** Known UPI PSP handles (lowercase). Unknown handles are accepted with lower confidence. */
export const UPI_HANDLES = new Set([
  "ybl", "ibl", "axl", "okhdfcbank", "okicici", "oksbi", "okaxis", "paytm", "ptyes", "pthdfc", "ptaxis",
  "ptsbi", "upi", "apl", "yapl", "rapl", "abfspay", "axisbank", "axisb", "hdfcbank", "hdfcbankjd", "icici",
  "sbi", "kotak", "kbl", "fbl", "federal", "idfcbank", "idfcfirst", "indus", "yesbank", "yesbankltd", "boi",
  "barodampay", "pnb", "unionbank", "uboi", "cnrb", "canarabank", "airtel", "airtelpaymentsbank", "jio",
  "freecharge", "slice", "naviaxis", "jupiteraxis", "waicici", "wahdfcbank", "waaxis", "wasbi", "postbank",
  "dbs", "rbl", "aubank", "equitas", "ikwik", "mahb", "centralbank", "iob", "indianbank", "allbank", "dlb",
  "kvb", "cub", "tjsb", "superyes", "timecosmos", "pingpay", "amazonpay", "apay", "idbi", "fam", "omni",
  "goaxb", "tapicici", "niyoicici", "kmbl", "mairtel", "sib", "csbpay", "dcb", "bandhan", "citi", "hsbc",
  "sc", "scb", "uco", "psb", "jkb", "ezeepay", "yesg", "fifederal", "pockets", "eazypay", "ubi",
]);
