/**
 * Keyword labels (English, Hindi, Hinglish) and line segmentation.
 *
 * A line is cut into segments at label positions: "A/c: 123 IFSC: X" →
 * [account → "123"], [ifsc → "X"]. Values are then attributed to the label of
 * the segment they occur in. Overlapping keywords resolve longest-first, so
 * "Bank Name" is a bank label (not a holder-name label), "Due Date" is not an
 * invoice date and "E-way Bill No" is not an invoice number.
 */

export type LabelCat =
  | "account"
  | "accType"
  | "holder"
  | "name"
  | "business"
  | "bank"
  | "branch"
  | "ifsc"
  | "micr"
  | "upi"
  | "upiApp"
  | "gstin"
  | "pan"
  | "phone"
  | "email"
  | "address"
  | "neg"
  | "otherNo"
  | "invoiceNo"
  | "invoiceNoDate"
  | "invoiceDate"
  | "date"
  | "dueDate"
  | "otherDate"
  | "total1"
  | "total2"
  | "total3"
  | "subtotal"
  | "tax"
  | "roundOff"
  | "nonTotal"
  | "words"
  | "seller"
  | "buyer";

const NO = String.raw`(?:\s*(?:no|nos|number|num|nr|nbr)\b\.?|\s*#)?`;
const AC = String.raw`(?:a\s*[/|\\]\s*c|a\.\s*c\.?|acc(?:oun)?t?|acnt|account|acount)`;

/** Regex sources per category (compiled case-insensitive, unicode). */
const LABELS: Record<LabelCat, string[]> = {
  account: [
    `${AC}\\.?${NO}`,
    String.raw`a[l1]c\s*(?:no|number)\b\.?`,
    String.raw`ac\s*(?:no|number)\b\.?|ac\s*#|ac\s*/\s*no`,
    String.raw`bank\s+${AC}${NO}`,
    String.raw`(?:sb|savings?|current|ca|cc|od)\s+${AC}${NO}`,
    String.raw`(?:बैंक\s+)?खाता(?:\s*(?:संख्या|नंबर|नम्बर|क्रमांक|सं\.?|नं\.?|न\.))?`,
    String.raw`खाते\s*(?:का\s*)?(?:नंबर|नम्बर|संख्या)`,
    String.raw`अकाउंट(?:\s*(?:नंबर|नम्बर|संख्या|नं\.?))?`,
    String.raw`khata(?:\s*(?:no|number|num|sankhya)\b)?\.?`,
  ],
  accType: [String.raw`${AC}\.?\s*type|खाता\s*प्रकार|account\s*category`],
  holder: [
    String.raw`${AC}\.?\s*(?:holder(?:'?s)?\s*)?name`,
    String.raw`${AC}\.?\s*holder(?:'?s)?`,
    String.raw`name\s+of\s+(?:the\s+)?(?:${AC})\s*holder|name\s+(?:as\s+)?(?:per|in)\s+bank(?:\s+records?)?`,
    String.raw`bene(?:fi|fe)ciary(?:\s*name)?|benificiary(?:\s*name)?|payee(?:\s*name)?`,
    String.raw`in\s+(?:the\s+)?fav(?:ou?r)?\s+of`,
    String.raw`खाता\s*धारक(?:\s*का)?(?:\s*नाम)?|खाताधारक(?:\s*का)?(?:\s*नाम)?|लाभार्थी(?:\s*का)?(?:\s*नाम)?`,
    String.raw`khata\s*dharak(?:\s*ka)?(?:\s*naam)?|account\s*(?:me|mein|main)\s*naam`,
  ],
  name: [String.raw`name|naam|नाम|full\s+name`],
  business: [
    String.raw`(?:firm|company|business|shop|store|trade|vendor|supplier)\s*(?:'s\s*)?name`,
    String.raw`(?:फर्म|दुकान|कंपनी|व्यापार)\s*(?:का\s*)?नाम`,
    String.raw`(?:firm|dukan|company)\s*(?:ka\s*)?naam`,
  ],
  bank: [
    String.raw`bank(?:\s*name)?|bank\s*ka\s*naam|name\s+of\s+(?:the\s+)?bank|bank\s*details?`,
    String.raw`बैंक(?:\s*(?:का\s*)?नाम)?|बैंक\s*विवरण`,
  ],
  branch: [String.raw`branch(?:\s*(?:name|address|code))?|शाखा(?:\s*का\s*नाम)?`],
  ifsc: [
    String.raw`ifsc?(?:\s*code)?|ifs\s*code|ifcs(?:\s*code)?`,
    String.raw`(?:rtgs|neft)\s*(?:/\s*(?:rtgs|neft)\s*)?(?:ifsc\s*)?code|ifsc\s*/\s*(?:neft|rtgs)(?:\s*code)?`,
    String.raw`आईएफएससी(?:\s*कोड)?|आई\.?एफ\.?एस\.?सी\.?(?:\s*कोड)?`,
  ],
  micr: [String.raw`micr(?:\s*code)?|swift(?:\s*code)?`],
  upi: [String.raw`upi(?:\s*(?:id|address|handle))?|vpa|यूपीआई(?:\s*आईडी)?|bhim(?:\s*upi)?`],
  upiApp: [String.raw`g\s*pay|google\s*pay|phone\s*pe|paytm(?:\s*(?:no|number)\b\.?)?`],
  gstin: [
    String.raw`gst\s*(?:in|n)?${NO}|gstin\s*/\s*uin|gst\s*reg(?:istration|n)?\.?${NO}|gst\s*id`,
    String.raw`जीएसटी(?:\s*(?:नंबर|नम्बर|संख्या|आईएन|न\.))?`,
  ],
  pan: [String.raw`pan(?:\s*(?:no|number|card)\b\.?)?|पैन(?:\s*(?:नंबर|कार्ड))?`],
  phone: [
    String.raw`mob(?:ile)?\.?${NO}|ph(?:one)?\.?${NO}|tel(?:ephone)?\.?${NO}|cell${NO}`,
    String.raw`contact(?:\s*(?:no|number|details)\b\.?)?|call(?:\s*(?:on|at))?|whats\s*app${NO}|wa\s*no\.?`,
    String.raw`helpline|landline|fax|mo\.`,
    String.raw`मोबाइल(?:\s*(?:नंबर|नम्बर|न\.|नं\.?))?|मो\.|फ़?ोन(?:\s*(?:नंबर|नम्बर|नं\.?))?|फ़ोन(?:\s*नंबर)?|संपर्क(?:\s*(?:सूत्र|नंबर))?|व्हाट्सएप(?:\s*नंबर)?`,
  ],
  email: [String.raw`e-?mail(?:\s*(?:id|address))?|ईमेल(?:\s*आईडी)?`],
  address: [String.raw`address|addr\.|पता|regd\.?\s*office|office`],
  neg: [
    String.raw`aadh?a+r(?:\s*(?:no|number|card)\b\.?)?|आधार(?:\s*(?:संख्या|नंबर|कार्ड))?|uid(?:ai)?${NO}`,
    String.raw`cif${NO}|cif\s*id|customer\s*(?:id|no|number)\b\.?|cust\.?\s*id|crn|client\s*(?:id|code)|user\s*id|login\s*id|member(?:ship)?\s*(?:id|no)\b\.?`,
    String.raw`(?:debit\s*|credit\s*|atm\s*)?card${NO}`,
    String.raw`ref(?:erence)?\.?${NO}|ref\s*id|utr${NO}|txn(?:\s*id)?${NO}|transaction(?:\s*(?:id|ref))?${NO}|rrn|order\s*id|tracking${NO}|awb${NO}|docket${NO}`,
    String.raw`pin(?:\s*code)?|pincode|पिन(?:\s*कोड)?|zip(?:\s*code)?`,
    String.raw`cheque${NO}|chq\.?${NO}|चेक(?:\s*(?:नंबर|संख्या))?`,
    String.raw`cin|llpin|udyam(?:\s*(?:reg(?:istration)?)?${NO})?|msme${NO}|fssai(?:\s*lic(?:ense|ence)?)?${NO}|d\.?\s*l\.?\s*no\.?|drug\s*lic(?:en[cs]e)?${NO}|lic(?:en[cs]e)?${NO}|tan${NO}|tin${NO}|iec${NO}|reg(?:istration|d)?\.?${NO}|shop\s*act`,
    String.raw`emp(?:loyee)?\s*id|vehicle${NO}|otp|cvv|hsn(?:\s*/\s*sac)?(?:\s*code)?|sac(?:\s*code)?`,
  ],
  otherNo: [
    String.raw`irn|ack(?:nowledgement)?\.?${NO}|e-?\s*way\s*bill${NO}|eway\s*bill${NO}`,
    String.raw`p\.?\s*o\.?${NO}|purchase\s*order${NO}|order${NO}|challan${NO}|d\.?\s*c\.?\s*no\.?|delivery\s*(?:note|challan)${NO}|l\.?\s*r\.?\s*no\.?|g\.?\s*r\.?\s*no\.?`,
    String.raw`dispatch(?:ed)?\s*(?:through|doc(?:ument)?${NO})|transporter|despatch\s*doc(?:ument)?${NO}|place\s*of\s*supply|state\s*code`,
  ],
  invoiceNo: [
    String.raw`(?:tax\s*)?inv(?:oice)?\.?\s*(?:no|number|num|nr)\b\.?|inv(?:oice)?\.?\s*#|invoice(?=\s*[:#])`,
    String.raw`bill\s*(?:no|number|num)\b\.?|bill\s*#|voucher\s*(?:no|number)\b\.?|doc(?:ument)?\.?\s*no\b\.?|receipt\s*no\b\.?|memo\s*no\b\.?|serial\s*no\.?\s*of\s*invoice`,
    String.raw`बिल\s*(?:नं\.?|नंबर|नम्बर|संख्या|क्रमांक|न\.)|इनवॉइस\s*(?:नं\.?|नंबर|संख्या)|चालान\s*(?:नं\.?|संख्या)|बीजक\s*(?:संख्या|नं\.?|क्रमांक)`,
  ],
  invoiceNoDate: [
    String.raw`(?:inv(?:oice)?|bill)\.?\s*(?:no|number)\b\.?\s*(?:&|and|/)\s*(?:date|dt\.?)`,
  ],
  invoiceDate: [
    String.raw`(?:tax\s*)?inv(?:oice)?\.?\s*date|bill\s*date|date\s*of\s*(?:invoice|issue|bill)|issue\s*date|invoice\s*dt\.?`,
    String.raw`बिल\s*(?:की\s*)?(?:तिथि|दिनांक|तारीख)|इनवॉइस\s*(?:की\s*)?(?:तिथि|दिनांक|तारीख)|बीजक\s*(?:तिथि|दिनांक)`,
  ],
  date: [String.raw`date|dated|dt\.?|dtd\.?|दिनांक|तारीख|तिथि|dinank|tarikh|ता\.`],
  dueDate: [
    String.raw`due\s*date|due\s*on|due\s*by|due|payment\s*due(?:\s*(?:date|by|on))?|pay(?:able)?\s*by|last\s*date(?:\s*(?:of|for)\s*payment)?|payment\s*date`,
    String.raw`देय\s*(?:तिथि|दिनांक|तारीख)|भुगतान\s*(?:की\s*)?(?:अंतिम\s*)?(?:तिथि|दिनांक|तारीख)|अंतिम\s*तिथि`,
  ],
  otherDate: [
    String.raw`(?:p\.?\s*o\.?|order|challan|d\.?\s*c\.?|delivery|dispatch|despatch|supply|e-?\s*way\s*bill|ack(?:nowledgement)?|l\.?\s*r\.?|g\.?\s*r\.?|cheque|chq|transaction|txn|irn|print(?:ed)?)\s*\.?\s*(?:date|dt\.?)`,
    String.raw`date\s*(?:&|and)\s*time\s*of\s*supply|date\s*of\s*(?:supply|delivery|dispatch|removal|order|birth)|valid(?:ity)?\s*(?:till|until|upto|up\s*to)|dob`,
  ],
  total1: [
    String.raw`grand\s*total|total\s*amount(?:\s*(?:payable|due|after\s*tax))?|total\s*amt\.?|total\s*payable|total\s*due|total\s*invoice\s*(?:value|amount)|invoice\s*(?:total|value|amount)`,
    String.raw`bill\s*(?:total|amount|amt\.?|value)|amount\s*payable|net\s*payable|net\s*amount|net\s*amt\.?|net\s*total|amount\s*due|balance\s*(?:due|payable)|payable\s*amount|total\s*bill(?:\s*amount)?`,
    String.raw`total\s*\(\s*(?:rounded|incl\.?[^)]{0,20})\s*\)|total\s*(?:rounded|after\s*tax|incl(?:\.|uding)?\s*(?:of\s*)?(?:gst|tax(?:es)?))`,
    String.raw`कुल\s*(?:राशि|देय(?:\s*राशि)?|योग|रकम|भुगतान|बिल\s*राशि)|देय\s*राशि|भुगतान\s*योग्य\s*राशि|kul\s*(?:rashi|raqam|amount)`,
  ],
  total2: [String.raw`total|कुल|kul|payable`],
  total3: [String.raw`amount|amt\.?|राशि|रकम|rashi|raqam`],
  subtotal: [
    String.raw`sub\s*-?\s*total|taxable\s*(?:value|amount|amt\.?)|total\s*taxable(?:\s*(?:value|amount))?|total\s*before\s*tax|amount\s*before\s*tax|कर\s*योग्य\s*(?:राशि|मूल्य)`,
  ],
  tax: [
    String.raw`(?:total\s*)?(?:c|s|i|ut)\s*gst(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?(?:\s*amount)?`,
    String.raw`total\s*(?:tax|gst)(?:\s*amount)?|tax\s*amount|gst\s*amount|gst\s*@\s*\d+(?:\.\d+)?\s*%|cess|vat|कर\s*राशि|tds|tcs`,
  ],
  roundOff: [String.raw`round(?:ing|ed)?\s*-?\s*off|rounding|r\.\s*off`],
  nonTotal: [
    String.raw`(?:total\s*)?discount|less|advance(?:\s*paid)?|amount\s*paid|paid|received|previous\s*balance|opening\s*balance|freight|shipping|packing(?:\s*charges)?|delivery\s*charges`,
    String.raw`total\s*(?:qty|quantity|items?|nos|pcs|units|weight)|कुल\s*(?:मात्रा|नग|वजन)|qty|quantity|rate|price|mrp|unit\s*price|s\.?\s*no\.?|sr\.?\s*no\.?|description|particulars|items?`,
  ],
  words: [String.raw`(?:total\s*)?(?:amount|amt|rupees|inr)?\s*(?:chargeable\s*)?\(?\s*in\s*words\s*\)?|शब्दों\s*में(?:\s*राशि)?`],
  seller: [
    String.raw`seller|supplier|sold\s*by|billed\s*by|bill\s*from|vendor|details\s*of\s*(?:supplier|seller)|विक्रेता|आपूर्तिकर्ता`,
    String.raw`^\s*from(?=\s*[:\-,]|\s*$)`,
  ],
  buyer: [
    String.raw`bill(?:ed)?\s*to|buyer(?:'?s)?(?:\s*(?:name|details))?|customer(?:'?s)?(?:\s*(?:name|details))?|ship(?:ped)?\s*to|consignee(?:'?s)?(?:\s*(?:name|details))?`,
    String.raw`recipient|receiver|details\s*of\s*(?:receiver|recipient|buyer|consignee)|sold\s*to|invoice\s*to|party(?:\s*(?:name|details))?`,
    String.raw`^\s*to(?=\s*[:\-,]|\s*$)|खरीदार|ग्राहक(?:\s*का\s*नाम)?|प्राप्तकर्ता|क्रेता`,
  ],
};

const PRE = String.raw`(?<![\p{L}\p{N}\p{M}])`;
const POST = String.raw`(?![\p{L}\p{M}]|/[\p{L}\p{N}])`;

const COMPILED: { cat: LabelCat; re: RegExp }[] = (Object.keys(LABELS) as LabelCat[]).flatMap((cat) =>
  LABELS[cat].map((src) => ({ cat, re: new RegExp(`${PRE}(?:${src})${POST}`, "giu") })),
);

export interface LabelHit {
  cat: LabelCat;
  start: number;
  end: number;
}

export interface Span {
  start: number;
  end: number;
}

/** All label hits on a line, longest-first, non-overlapping, never inside protected spans. */
export function findLabels(line: string, protectedSpans: Span[] = []): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const { cat, re } of COMPILED) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      if (!m[0].trim()) continue;
      // Trim leading whitespace captured by ^\s* patterns.
      const lead = m[0].length - m[0].trimStart().length;
      hits.push({ cat, start: m.index + lead, end: m.index + m[0].length });
    }
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: LabelHit[] = [];
  for (const h of hits) {
    if (protectedSpans.some((p) => h.start < p.end && p.start < h.end)) continue;
    if (chosen.some((c) => h.start < c.end && c.start < h.end)) continue;
    chosen.push(h);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

export interface Segment {
  /** Line index the value text comes from. */
  line: number;
  label: LabelHit | null;
  /** Line the label sits on (differs from `line` for "Label:\nvalue" layouts). */
  labelLine: number;
  /** Offset of `text` within lines[line]. */
  offset: number;
  text: string;
}

const LEAD_JUNK = /^[\s:;.\-=#>)*|~,]+/u;
const LEAD_WORDS = /^(?:is|hai|है|h|:-|-)\s+/iu;

function cleanLead(text: string): { text: string; cut: number } {
  let t = text;
  let cut = 0;
  for (let i = 0; i < 3; i++) {
    const m = t.match(LEAD_JUNK) ?? t.match(LEAD_WORDS);
    if (!m) break;
    cut += m[0].length;
    t = t.slice(m[0].length);
  }
  return { text: t, cut };
}

function isEmptyValue(s: string): boolean {
  return !/[\p{L}\p{N}]/u.test(s);
}

/**
 * Cuts lines into labelled segments. `protect[i]` are spans of line i that
 * labels must not overlap (bank names, emails, UPI ids, URLs).
 */
export function segmentLines(lines: string[], protect: Span[][]): { segments: Segment[]; labels: LabelHit[][] } {
  const labels = lines.map((l, i) => findLabels(l, protect[i] ?? []));
  const segments: Segment[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    const line = lines[i];
    const hits = labels[i];
    if (!hits.length) {
      if (line.trim()) segments.push({ line: i, label: null, labelLine: i, offset: 0, text: line });
      continue;
    }
    if (hits[0].start > 0 && !isEmptyValue(line.slice(0, hits[0].start))) {
      segments.push({ line: i, label: null, labelLine: i, offset: 0, text: line.slice(0, hits[0].start) });
    }
    const values = hits.map((h, k) => {
      const end = k + 1 < hits.length ? hits[k + 1].start : line.length;
      const raw = line.slice(h.end, end);
      const { text, cut } = cleanLead(raw);
      return { text, offset: h.end + cut };
    });
    const next = i + 1 < lines.length ? i + 1 : -1;
    const nextFree = next >= 0 && !labels[next].length && lines[next].trim() !== "";
    const allEmpty = values.every((v) => isEmptyValue(v.text));
    // Item-table header ("S.No  Description  Qty  Rate  Amount"): rows below are
    // line items, not values of these labels.
    const tableHeader = hits.length >= 3 && hits.filter((h) => h.cat === "nonTotal" || h.cat === "neg").length >= 2;
    if (tableHeader) {
      hits.forEach((h, k) => segments.push({ line: i, label: h, labelLine: i, offset: values[k].offset, text: values[k].text }));
      continue;
    }

    if (nextFree && allEmpty && hits.length > 1) {
      // Column header row: "Invoice No.   Date" / "INV-42   12/03/2025"
      const nextLine = lines[next];
      let chunks = splitChunks(nextLine, /\s{2,}|\s\|\s|\t/);
      if (chunks.length !== hits.length) chunks = splitChunks(nextLine, /\s+/);
      if (chunks.length === hits.length) {
        hits.forEach((h, k) =>
          segments.push({ line: next, label: h, labelLine: i, offset: chunks[k].offset, text: chunks[k].text }),
        );
        consumed.add(next);
        continue;
      }
    }
    hits.forEach((h, k) => {
      const v = values[k];
      if (k === hits.length - 1 && isEmptyValue(v.text) && nextFree) {
        const { text, cut } = cleanLead(lines[next]);
        segments.push({ line: next, label: h, labelLine: i, offset: cut, text });
        consumed.add(next);
      } else {
        segments.push({ line: i, label: h, labelLine: i, offset: v.offset, text: v.text });
      }
    });
  }
  return { segments, labels };
}

function splitChunks(line: string, sep: RegExp): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  const re = new RegExp(sep.source, "g");
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), offset: last });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), offset: last });
  return out.filter((c) => c.text.trim());
}

/** True when the line holds nothing but labels and punctuation. */
export function isPureLabelLine(line: string, hits: LabelHit[]): boolean {
  if (!hits.length) return false;
  let rest = line;
  for (const h of [...hits].reverse()) rest = rest.slice(0, h.start) + rest.slice(h.end);
  return isEmptyValue(rest);
}
