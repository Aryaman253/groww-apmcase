/**
 * Generates synthetic, obviously fictional eval fixtures with known answers:
 *   evals/fixtures/<id>.{txt,png,jpg,pdf}  + <id>.expected.json
 *
 * All names carry "(Demo)", account numbers are dummy patterns, GSTINs have
 * valid checksums but fictional PANs. Images are rendered from SVG via sharp
 * (librsvg + fontconfig: Inter / FreeSans / DejaVu Sans Mono), PDFs via
 * pdf-lib with an embedded font so they carry a real text layer.
 *
 * Run: npx tsx evals/generate-fixtures.ts   (deterministic; re-run overwrites)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { gstinCheckChar } from "../src/lib/validation";
import type { FixtureSpec } from "./types";

const OUT = path.join(__dirname, "fixtures");

const FONTS = {
  en: "/usr/share/fonts/opentype/inter/Inter-Regular.otf",
  enBold: "/usr/share/fonts/opentype/inter/Inter-Bold.otf",
  hi: "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  hiBold: "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  mono: "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
};

// ───────────────────────── fictional identities ─────────────────────────

function gstin(state: string, pan: string, entity = "1"): string {
  const first14 = `${state}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}
const G = {
  sunrise: gstin("27", "AAKFS1234Q"),
  blue: gstin("24", "AACCB5678R"),
  delta: gstin("29", "AAJFD4321M"),
  ganesh: gstin("09", "ABCPG1111K"),
  om: gstin("27", "AAEPO2222L"),
  kaveri: gstin("33", "AAGCK3333N", "2"),
  laxmi: gstin("27", "AAHFL4444P"),
  patel: gstin("24", "AAIFP5555R"),
  sharma: gstin("07", "ABJPS6666T"),
  anna: gstin("09", "AAKFA7777V"),
  bright: gstin("27", "AALFB8888X"),
  lakshmi: gstin("33", "AAMFL9999Z"),
  tarrow: gstin("27", "AAACT0000A"),
  electricals: gstin("27", "AANFG1212B"),
};

// ───────────────────────── number to words (Indian) ─────────────────────────

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function below100(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}
function inWords(paise: number): string {
  let n = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${below100(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return `Rupees ${parts.join(" ")}${p ? ` and ${below100(p)} Paise` : ""} Only`;
}
function inr(paise: number): string {
  const r = Math.floor(paise / 100);
  const s = String(r);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest ? `${rest},` : ""}${last3}.${String(paise % 100).padStart(2, "0")}`;
}

// ───────────────────────── tiny layout model ─────────────────────────

type Font = "en" | "hi" | "mono";
interface TextEl {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
  font?: Font;
  anchor?: "start" | "end" | "middle";
  fill?: string;
  /** Rendered but not part of the ground-truth text (watermarks, MICR glyphs). */
  decorative?: boolean;
  rotate?: number;
  opacity?: number;
}
interface RectEl {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  rx?: number;
}
interface LineEl {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  width?: number;
}
type El = TextEl | RectEl | LineEl;
interface Page {
  width: number;
  height: number;
  bg: string;
  els: El[];
  defs?: string;
}

const t = (x: number, y: number, text: string, o: Partial<TextEl> = {}): TextEl => ({ kind: "text", x, y, text, ...o });

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const FAMILY: Record<Font, string> = { en: "Inter, FreeSans", hi: "FreeSans, Inter", mono: "DejaVu Sans Mono" };

function toSvg(p: Page): string {
  const body = p.els
    .map((e) => {
      if (e.kind === "rect") {
        return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.rx ?? 0}" fill="${e.fill ?? "none"}" stroke="${e.stroke ?? "none"}"/>`;
      }
      if (e.kind === "line") {
        return `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.stroke ?? "#333"}" stroke-width="${e.width ?? 1.5}"/>`;
      }
      const tr = e.rotate ? ` transform="rotate(${e.rotate} ${e.x} ${e.y})"` : "";
      return `<text x="${e.x}" y="${e.y}" font-family="${FAMILY[e.font ?? "en"]}" font-size="${e.size ?? 22}" font-weight="${e.bold ? 700 : 400}" text-anchor="${e.anchor ?? "start"}" fill="${e.fill ?? "#111"}" opacity="${e.opacity ?? 1}"${tr}>${esc(e.text)}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}">${p.defs ?? ""}<rect width="100%" height="100%" fill="${p.bg}"/>${body}</svg>`;
}

/** Ground-truth text in reading order (rows by baseline, columns joined by two spaces). */
function truthText(p: Page): string {
  const texts = p.els.filter((e): e is TextEl => e.kind === "text" && !e.decorative);
  const rows: TextEl[][] = [];
  for (const e of [...texts].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - e.y) < 6) row.push(e);
    else rows.push([e]);
  }
  return rows.map((r) => r.sort((a, b) => xLeft(a) - xLeft(b)).map((e) => e.text).join("  ")).join("\n");
}
function xLeft(e: TextEl): number {
  const w = e.text.length * (e.size ?? 22) * 0.5;
  return e.anchor === "end" ? e.x - w : e.anchor === "middle" ? e.x - w / 2 : e.x;
}

interface Degrade {
  rotate?: number;
  blur?: number;
  noise?: number;
  jpeg?: number;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function renderImage(p: Page, file: string, d: Degrade = {}, seed = 1): Promise<void> {
  let img = sharp(Buffer.from(toSvg(p)), { density: 72 });
  if (d.noise) {
    const base = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = rng(seed);
    const px = base.data;
    for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, px[i] + (r() - 0.5) * d.noise));
    img = sharp(px, { raw: { width: base.info.width, height: base.info.height, channels: base.info.channels } });
  }
  if (d.rotate) img = img.rotate(d.rotate, { background: "#f4f2ee" });
  if (d.blur) img = img.blur(d.blur);
  const buf = d.jpeg
    ? await img.jpeg({ quality: d.jpeg, mozjpeg: true }).toBuffer()
    : await img.png({ compressionLevel: 9, palette: true, colors: 48, effort: 10 }).toBuffer();
  writeFileSync(path.join(OUT, file), buf);
}

async function renderPdf(p: Page, file: string, hindi = false): Promise<void> {
  if (hindi && !("regeneratorRuntime" in globalThis)) {
    // fontkit's Indic shaper expects a global regeneratorRuntime (transitive dep).
    try {
      createRequire(__filename)("regenerator-runtime/runtime");
    } catch {
      console.warn("[fixtures] regenerator-runtime missing: Hindi PDF shaping may fail");
    }
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setCreator("TArrow eval fixtures");
  pdf.setProducer("pdf-lib");
  pdf.setCreationDate(new Date("2025-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2025-01-01T00:00:00Z"));
  const regular = await pdf.embedFont(readFileSync(hindi ? FONTS.hi : FONTS.en), { subset: true });
  const bold = await pdf.embedFont(readFileSync(hindi ? FONTS.hiBold : FONTS.enBold), { subset: true });
  const k = 595 / p.width;
  const page = pdf.addPage([595, p.height * k]);
  const H = p.height * k;
  const color = (hex?: string) => {
    const h = (hex ?? "#111111").replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  for (const e of p.els) {
    if (e.kind === "rect") {
      page.drawRectangle({
        x: e.x * k,
        y: H - (e.y + e.h) * k,
        width: e.w * k,
        height: e.h * k,
        color: e.fill && e.fill !== "none" ? color(e.fill) : undefined,
        borderColor: e.stroke ? color(e.stroke) : undefined,
        borderWidth: e.stroke ? 0.6 : 0,
      });
    } else if (e.kind === "line") {
      page.drawLine({ start: { x: e.x1 * k, y: H - e.y1 * k }, end: { x: e.x2 * k, y: H - e.y2 * k }, thickness: 0.6, color: color(e.stroke) });
    } else {
      const font = e.bold ? bold : regular;
      const size = (e.size ?? 22) * k;
      const w = font.widthOfTextAtSize(e.text, size);
      const x = e.anchor === "end" ? e.x * k - w : e.anchor === "middle" ? e.x * k - w / 2 : e.x * k;
      page.drawText(e.text, { x, y: H - e.y * k, size, font, color: color(e.fill) });
    }
  }
  writeFileSync(path.join(OUT, file), await pdf.save({ useObjectStreams: false }));
}

// ───────────────────────── vendor fixtures ─────────────────────────

type VExp = FixtureSpec["expected"];
const V0 = { accountHolderName: null, accountNumber: null, ifsc: null, bankName: null, upiId: null, gstin: null, phone: null, email: null };
const v = (e: Partial<Record<keyof typeof V0, string | null>>): VExp => ({ ...V0, ...e });

interface VendorText {
  id: string;
  description: string;
  lang: "en" | "hi";
  text: string;
  expected: VExp;
  candidates?: Record<string, string[]>;
}

const VENDOR_TEXT: VendorText[] = [
  {
    id: "v01-whatsapp-en",
    description: "WhatsApp, English, all labelled, emojis",
    lang: "en",
    text: `Hi sir, pls find our bank details 👇
Name: Sunrise Pharma Distributors (Demo)
A/c No: 50100 0012 3456 78
IFSC: HDFC0001234
Bank: HDFC Bank, Andheri East
UPI: sunrisedemo@okhdfcbank
GSTIN: ${G.sunrise}
Thanks 🙏`,
    expected: v({ accountHolderName: "Sunrise Pharma Distributors (Demo)", accountNumber: "501000012345678", ifsc: "HDFC0001234", bankName: "HDFC Bank", upiId: "sunrisedemo@okhdfcbank", gstin: G.sunrise }),
  },
  {
    id: "v02-sms-compact",
    description: "SMS, single line, 'Acc no:-' and hyphen separators",
    lang: "en",
    text: "Acc no:-112233445566 IFSC-SBIN0001234 Name-Ravi Kumar Traders (Demo) Mob 9876543210",
    expected: v({ accountHolderName: "Ravi Kumar Traders (Demo)", accountNumber: "112233445566", ifsc: "SBIN0001234", bankName: "State Bank of India", phone: "9876543210" }),
  },
  {
    id: "v03-email-signature",
    description: "Email with signature block, +91 phone, email, GSTIN",
    lang: "en",
    text: `Dear Sir/Madam,

Please update our bank details for future NEFT payments.

Beneficiary Name: Bluewave Textiles (Demo)
Bank Name: ICICI Bank
Account Number: 000405001234
IFSC Code: ICIC0000004

Regards,
Anil Mehta (Demo)
Accounts Dept, Bluewave Textiles (Demo)
Ph: +91 98200 11223 | anil.mehta@bluewave-demo.in
GSTIN: ${G.blue}`,
    expected: v({ accountHolderName: "Bluewave Textiles (Demo)", accountNumber: "000405001234", ifsc: "ICIC0000004", bankName: "ICICI Bank", gstin: G.blue, phone: "9820011223", email: "anil.mehta@bluewave-demo.in" }),
  },
  {
    id: "v04-hinglish-whatsapp",
    description: "Hinglish WhatsApp: Khata no / Naam / Gpay",
    lang: "en",
    text: `Bhai payment yaha karo 👇
Khata no 3456 7890 1234
IFSC code: UTIB0000123
Naam: Gupta Kirana Store (Demo)
Gpay 9811122233`,
    expected: v({ accountHolderName: "Gupta Kirana Store (Demo)", accountNumber: "345678901234", ifsc: "UTIB0000123", bankName: "Axis Bank", phone: "9811122233" }),
  },
  {
    id: "v05-hindi",
    description: "Hindi labels: खाता धारक / खाता संख्या / आईएफएससी / बैंक / मोबाइल",
    lang: "hi",
    text: `नमस्ते जी, भुगतान के लिए विवरण:
खाता धारक: श्याम ट्रेडर्स (डेमो)
खाता संख्या: 000123456789012
आईएफएससी: PUNB0123400
बैंक: पंजाब नेशनल बैंक
मोबाइल: 9988776655`,
    expected: v({ accountHolderName: "श्याम ट्रेडर्स (डेमो)", accountNumber: "000123456789012", ifsc: "PUNB0123400", bankName: "Punjab National Bank", phone: "9988776655" }),
  },
  {
    id: "v06-ambiguous-two-accounts",
    description: "Two account-like numbers, no keyword → must be null with candidates",
    lang: "en",
    text: "Sir, payment in 112200334455 or 998877001122, both ok. IFSC KKBK0000123",
    expected: v({ ifsc: "KKBK0000123", bankName: "Kotak Mahindra Bank" }),
    candidates: { accountNumber: ["112200334455", "998877001122"] },
  },
  {
    id: "v07-two-banks",
    description: "Two labelled accounts at two banks → account/IFSC/bank ambiguous",
    lang: "en",
    text: `Our accounts:
HDFC A/c: 123400005678 IFSC HDFC0000123
SBI A/c: 300012345678 IFSC SBIN0011223
Name: Patel Brothers (Demo)`,
    expected: v({ accountHolderName: "Patel Brothers (Demo)" }),
    candidates: { accountNumber: ["123400005678", "300012345678"], ifsc: ["HDFC0000123", "SBIN0011223"] },
  },
  {
    id: "v08-upi-phone-only",
    description: "Only Paytm/GPay number + UPI; phone must not become account",
    lang: "en",
    text: `Paytm / GPay: 9876501234
UPI: demokirana@ybl`,
    expected: v({ upiId: "demokirana@ybl", phone: "9876501234" }),
  },
  {
    id: "v09-no-keywords",
    description: "No keywords at all: name, phone, account, IFSC on separate lines",
    lang: "en",
    text: `Ramesh Demo Traders
9876543210
123456789012
ICIC0001234`,
    expected: v({ accountHolderName: "Ramesh Demo Traders", accountNumber: "123456789012", ifsc: "ICIC0001234", bankName: "ICICI Bank", phone: "9876543210" }),
  },
  {
    id: "v10-gstin-pan",
    description: "Firm name, GSTIN, PAN distractor, 'Current A/c'",
    lang: "en",
    text: `Firm name: Delta Hardware (Demo)
GSTIN: ${G.delta}
PAN: AAJFD4321M
Current A/c 0011223344556
IFSC YESB0000456`,
    expected: v({ accountHolderName: "Delta Hardware (Demo)", gstin: G.delta, accountNumber: "0011223344556", ifsc: "YESB0000456", bankName: "Yes Bank" }),
  },
  {
    id: "v11-emoji-linebreaks",
    description: "Emoji bullets, value on the line after its label, 📞 as phone label",
    lang: "en",
    text: `🏦 Bank: Axis Bank
💳 A/c:
9180 1000 2233 4455
🔑 IFSC: UTIB0001122
👤 Name: Meera Foods (Demo)
📞 98111 22334`,
    expected: v({ bankName: "Axis Bank", accountNumber: "9180100022334455", ifsc: "UTIB0001122", accountHolderName: "Meera Foods (Demo)", phone: "9811122334" }),
  },
  {
    id: "v12-aadhaar-distractor",
    description: "Aadhaar-formatted 12 digits must not be the account",
    lang: "en",
    text: `Name: Kiran Demo
Aadhaar: 1234 5678 9012
A/c No 66778899001122
IFSC BARB0DEMO12`,
    expected: v({ accountHolderName: "Kiran Demo", accountNumber: "66778899001122", ifsc: "BARB0DEMO12", bankName: "Bank of Baroda" }),
  },
  {
    id: "v13-contact-no-bank",
    description: "Contact card without bank details; contact person is not the account holder",
    lang: "en",
    text: `Contact: Priya Sharma (Demo)
Email: accounts@demo-supplies.in
Mobile: 9000012345`,
    expected: v({ email: "accounts@demo-supplies.in", phone: "9000012345" }),
  },
  {
    id: "v14-lowercase-spaces",
    description: "Lowercase, 'acc no:-', spaced account, 'name - …'",
    lang: "en",
    text: `acc no:- 0123 4567 8901 23
ifsc - cnrb0001234
name - Lakshmi Agencies (Demo)`,
    expected: v({ accountNumber: "01234567890123", ifsc: "CNRB0001234", bankName: "Canara Bank", accountHolderName: "Lakshmi Agencies (Demo)" }),
  },
  {
    id: "v15-invoice-distractor",
    description: "Bill number and amount in the same message must not become the account",
    lang: "en",
    text: `Bill No 2025004512 dt 03/04/2025 amount ₹12,500
Pay to A/c 445566778899 IFSC IDIB000K123 (Indian Bank)`,
    expected: v({ accountNumber: "445566778899", ifsc: "IDIB000K123", bankName: "Indian Bank" }),
  },
  {
    id: "v16-devanagari-digits",
    description: "Devanagari digits in account and phone",
    lang: "hi",
    text: `नाम: राजेश कुमार (डेमो)
खाता नं. ३४५६७८९०१२३४
IFSC: BKID0004567
फोन: ९८७६५४३२१०`,
    expected: v({ accountHolderName: "राजेश कुमार (डेमो)", accountNumber: "345678901234", ifsc: "BKID0004567", bankName: "Bank of India", phone: "9876543210" }),
  },
  {
    id: "v17-nothing",
    description: "No details at all → everything null",
    lang: "en",
    text: "Hello, I will send the details tomorrow. Thanks!",
    expected: v({}),
  },
  {
    id: "v18-customer-id-micr",
    description: "Customer ID (9 digits) and MICR distractors",
    lang: "en",
    text: `Customer ID: 123456789
A/c Number: 20123456789
MICR: 400240015
IFSC: SBIN0001234
Account Name: Ganesh Electricals (Demo)`,
    expected: v({ accountNumber: "20123456789", ifsc: "SBIN0001234", bankName: "State Bank of India", accountHolderName: "Ganesh Electricals (Demo)" }),
  },
  {
    id: "v19-two-upi",
    description: "Two UPI ids → ambiguous; email must not be read as UPI",
    lang: "en",
    text: `Pay on GPay: demo1@okaxis or PhonePe: demo2@ybl
Email - shreeganesh.demo@gmail.com`,
    expected: v({ email: "shreeganesh.demo@gmail.com" }),
    candidates: { upiId: ["demo1@okaxis", "demo2@ybl"] },
  },
];

// ── vendor images ──

function chequePage(o: { bank: string; branch: string; ifscLine: string; acLine: string; forName: string; sign: string; micr: string }): Page {
  const W = 1400;
  const H = 640;
  return {
    width: W,
    height: H,
    bg: "#e8f1ee",
    defs: `<defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 12 Q6 0 12 12 T24 12" stroke="#d3e4de" fill="none"/></pattern></defs>`,
    els: [
      { kind: "rect", x: 0, y: 0, w: W, h: H, fill: "url(#p)" },
      t(40, 64, o.bank, { size: 40, bold: true, fill: "#123c69" }),
      t(40, 100, o.branch, { size: 20, fill: "#333" }),
      t(40, 130, o.ifscLine, { size: 22, bold: true }),
      t(1000, 70, "Date", { size: 20 }),
      { kind: "rect", x: 1060, y: 46, w: 300, h: 34, stroke: "#555" },
      t(40, 210, "Pay", { size: 24 }),
      { kind: "line", x1: 100, y1: 214, x2: 1180, y2: 214, stroke: "#777" },
      t(1200, 210, "or Bearer", { size: 20 }),
      t(40, 280, "Rupees", { size: 24 }),
      { kind: "line", x1: 140, y1: 284, x2: 980, y2: 284, stroke: "#777" },
      { kind: "rect", x: 1040, y: 250, w: 320, h: 50, stroke: "#555", fill: "#fff" },
      t(1052, 284, "₹", { size: 28 }),
      t(40, 360, o.acLine, { size: 26, bold: true }),
      t(900, 440, o.forName, { size: 24, bold: true }),
      t(980, 530, o.sign, { size: 20 }),
      { kind: "line", x1: 900, y1: 500, x2: 1340, y2: 500, stroke: "#999" },
      t(320, 400, "CANCELLED", { size: 130, bold: true, fill: "#c0392b", opacity: 0.28, rotate: -12, decorative: true }),
      { kind: "line", x1: 160, y1: 20, x2: 260, y2: 620, stroke: "#444", width: 2 },
      { kind: "line", x1: 200, y1: 20, x2: 300, y2: 620, stroke: "#444", width: 2 },
      t(230, 600, o.micr, { size: 30, font: "mono", fill: "#222" }),
    ],
  };
}

function chatPage(o: { title: string; bubbles: { me: boolean; lines: string[]; time: string }[]; font?: Font; sms?: boolean }): Page {
  const W = 720;
  const els: El[] = [];
  const header = o.sms ? "#3b5998" : "#075e54";
  els.push({ kind: "rect", x: 0, y: 0, w: W, h: 90, fill: header });
  els.push(t(90, 56, o.title, { size: 28, bold: true, fill: "#fff", font: o.font }));
  let y = 130;
  for (const b of o.bubbles) {
    const lh = 38;
    const h = b.lines.length * lh + 44;
    const width = Math.min(620, Math.max(...b.lines.map((l) => l.length)) * 14 + 60);
    const x = b.me ? W - width - 20 : 20;
    els.push({ kind: "rect", x, y, w: width, h, rx: 14, fill: b.me ? (o.sms ? "#d6e4ff" : "#dcf8c6") : "#ffffff" });
    b.lines.forEach((l, k) => els.push(t(x + 22, y + 40 + k * lh, l, { size: 25, font: o.font })));
    els.push(t(x + width - 18, y + h - 12, b.time, { size: 16, fill: "#888", anchor: "end", decorative: true }));
    y += h + 24;
  }
  return { width: W, height: y + 30, bg: o.sms ? "#f2f2f2" : "#ece5dd", els };
}

interface VendorImage {
  id: string;
  description: string;
  lang: "en" | "hi";
  page: Page;
  degrade?: Degrade;
  expected: VExp;
  candidates?: Record<string, string[]>;
}

const VENDOR_IMAGES: VendorImage[] = [
  {
    id: "v20-cheque-hdfc",
    description: "Cancelled cheque (HDFC), MICR band, 'For … / Authorised Signatory'",
    lang: "en",
    page: chequePage({
      bank: "HDFC BANK",
      branch: "Branch: Demo Nagar, Pune 411001",
      ifscLine: "RTGS/NEFT IFSC: HDFC0004321",
      acLine: "A/c No. 50200012345678",
      forName: "For BRIGHT STAR ENTERPRISES (DEMO)",
      sign: "Authorised Signatory",
      micr: '"000123"  411240015:  004321"  31',
    }),
    expected: v({ accountHolderName: "BRIGHT STAR ENTERPRISES (DEMO)", accountNumber: "50200012345678", ifsc: "HDFC0004321", bankName: "HDFC Bank" }),
  },
  {
    id: "v21-cheque-sbi-photo",
    description: "Cancelled cheque (SBI), photographed: slight rotation, noise, JPEG",
    lang: "en",
    page: chequePage({
      bank: "STATE BANK OF INDIA",
      branch: "Demo Bazar Branch, Jaipur 302001",
      ifscLine: "IFS Code: SBIN0012345",
      acLine: "A/c No. 3012 3456 7890",
      forName: "For MAA DURGA TRADERS (DEMO)",
      sign: "Proprietor",
      micr: '"000456"  302002015:  012345"  10',
    }),
    degrade: { rotate: -1.2, noise: 28, blur: 0.6, jpeg: 70 },
    expected: v({ accountHolderName: "MAA DURGA TRADERS (DEMO)", accountNumber: "301234567890", ifsc: "SBIN0012345", bankName: "State Bank of India" }),
  },
  {
    id: "v22-whatsapp-en-screenshot",
    description: "WhatsApp screenshot, English",
    lang: "en",
    page: chatPage({
      title: "Kaveri Foods (Demo)",
      bubbles: [
        { me: false, lines: ["Sir please note our bank details"], time: "10:41 am" },
        { me: false, lines: ["A/c Name: Kaveri Foods (Demo)", "A/c No: 7788 9900 1122", "IFSC: CNRB0004455", "Canara Bank, Mysuru", `GSTIN: ${G.kaveri}`], time: "10:42 am" },
        { me: true, lines: ["Ok noted, will pay today"], time: "10:45 am" },
      ],
    }),
    expected: v({ accountHolderName: "Kaveri Foods (Demo)", accountNumber: "778899001122", ifsc: "CNRB0004455", bankName: "Canara Bank", gstin: G.kaveri }),
  },
  {
    id: "v23-whatsapp-hinglish-screenshot",
    description: "WhatsApp screenshot, Hinglish",
    lang: "en",
    page: chatPage({
      title: "Sharma Ji (Demo)",
      bubbles: [
        { me: true, lines: ["Bhaiya details bhej do"], time: "6:02 pm" },
        { me: false, lines: ["Khata no: 5566 7788 9900", "IFSC: PUNB0098700", "Naam: Sharma General Store (Demo)", "Mob: 9811100223"], time: "6:05 pm" },
      ],
    }),
    expected: v({ accountNumber: "556677889900", ifsc: "PUNB0098700", bankName: "Punjab National Bank", accountHolderName: "Sharma General Store (Demo)", phone: "9811100223" }),
  },
  {
    id: "v24-hindi-screenshot",
    description: "WhatsApp screenshot, Hindi (Devanagari) labels",
    lang: "hi",
    page: chatPage({
      title: "अन्नपूर्णा किराना (डेमो)",
      font: "hi",
      bubbles: [
        { me: false, lines: ["खाताधारक का नाम: अन्नपूर्णा किराना (डेमो)", "खाता संख्या: 112233445566", "आईएफएससी: BARB0VJDEMO", "बैंक: बैंक ऑफ बड़ौदा", "फोन: 9876512340"], time: "9:15 am" },
      ],
    }),
    expected: v({ accountHolderName: "अन्नपूर्णा किराना (डेमो)", accountNumber: "112233445566", ifsc: "BARB0VJDEMO", bankName: "Bank of Baroda", phone: "9876512340" }),
  },
  {
    id: "v25-sms-ambiguous-screenshot",
    description: "SMS screenshot with two unlabelled account numbers → null",
    lang: "en",
    page: chatPage({
      title: "VK-DEMO",
      sms: true,
      bubbles: [{ me: false, lines: ["Payment karo 223344556677", "ya 334455667788 me, dono", "chalega. IFSC IOBA0001234"], time: "Yesterday" }],
    }),
    expected: v({ ifsc: "IOBA0001234", bankName: "Indian Overseas Bank" }),
    candidates: { accountNumber: ["223344556677", "334455667788"] },
  },
];

// ───────────────────────── invoices ─────────────────────────

interface Item {
  desc: string;
  hsn: string;
  qty: number;
  rate: number; // rupees
}
interface InvoiceSpec {
  id: string;
  description: string;
  format: "pdf" | "png" | "jpg";
  lang: "en" | "hi";
  seller: { name: string; address: string; gstin?: string; phone?: string };
  title: string;
  meta: "stacked" | "right" | "columns" | "combined";
  invNoLabel: string;
  invNo: string;
  dateLabel: string;
  dateText: string;
  dueLabel?: string;
  dueText?: string;
  buyer?: { label: string; name: string; gstin?: string; gstinLabel?: string };
  sellerGstinLabel?: string;
  /** Put supplier/recipient GSTINs on one row ("Supplier GSTIN: …   Recipient GSTIN: …"). */
  gstinRow?: boolean;
  items: Item[];
  tax: "intra" | "inter" | "none";
  totalLabel: string;
  showWords?: boolean;
  terms?: string;
  bankFooter?: string;
  extraTotals?: { label: string; paise: number }[];
  noGrandTotal?: boolean;
  degrade?: Degrade;
  expected: FixtureSpec["expected"];
  candidates?: Record<string, (string | number)[]>;
}

function invoicePage(s: InvoiceSpec): Page {
  const W = 1240;
  const F: Font = s.lang === "hi" ? "hi" : "en";
  const els: El[] = [];
  const T = (x: number, y: number, text: string, o: Partial<TextEl> = {}) => els.push(t(x, y, text, { font: F, ...o }));
  let y = 70;
  T(W / 2, y, s.title, { size: 30, bold: true, anchor: "middle" });
  y += 60;
  T(60, y, s.seller.name, { size: 34, bold: true });
  y += 38;
  T(60, y, s.seller.address, { size: 20, fill: "#333" });
  y += 32;
  if (s.seller.gstin && !s.gstinRow) {
    T(60, y, `${s.sellerGstinLabel ?? "GSTIN"}: ${s.seller.gstin}`, { size: 22 });
    if (s.seller.phone) T(700, y, `Ph: ${s.seller.phone}`, { size: 22 });
    y += 32;
  } else if (s.seller.phone) {
    T(60, y, `Ph: ${s.seller.phone}`, { size: 22 });
    y += 32;
  }
  els.push({ kind: "line", x1: 40, y1: y, x2: W - 40, y2: y, stroke: "#222", width: 2 });
  y += 44;

  const metaPairs: [string, string][] = [
    [s.invNoLabel, s.invNo],
    [s.dateLabel, s.dateText],
  ];
  if (s.dueLabel && s.dueText) metaPairs.push([s.dueLabel, s.dueText]);

  const buyerLines: string[] = [];
  if (s.buyer) {
    buyerLines.push(`${s.buyer.label}`, s.buyer.name);
    if (s.buyer.gstin && !s.gstinRow) buyerLines.push(`${s.buyer.gstinLabel ?? "GSTIN"}: ${s.buyer.gstin}`);
  }

  if (s.meta === "columns") {
    metaPairs.forEach(([l, val], k) => {
      T(60 + k * 380, y, l, { size: 22, bold: true });
      T(60 + k * 380, y + 32, val, { size: 22 });
    });
    y += 84;
    buyerLines.forEach((l, k) => T(60, y + k * 32, l, { size: 22, bold: k === 0 }));
    y += buyerLines.length * 32 + 20;
  } else if (s.meta === "right") {
    const rows = Math.max(buyerLines.length, metaPairs.length);
    for (let k = 0; k < rows; k++) {
      if (buyerLines[k]) T(60, y + k * 32, buyerLines[k], { size: 22, bold: k === 0 });
      if (metaPairs[k]) T(740, y + k * 32, `${metaPairs[k][0]}: ${metaPairs[k][1]}`, { size: 22 });
    }
    y += rows * 32 + 20;
  } else if (s.meta === "combined") {
    T(60, y, `${s.invNoLabel}: ${s.invNo} ${s.dateLabel} ${s.dateText}`, { size: 22 });
    y += 32;
    if (s.dueLabel && s.dueText) {
      T(60, y, `${s.dueLabel}: ${s.dueText}`, { size: 22 });
      y += 32;
    }
    y += 12;
    buyerLines.forEach((l, k) => T(60, y + k * 32, l, { size: 22, bold: k === 0 }));
    y += buyerLines.length * 32 + 20;
  } else {
    metaPairs.forEach(([l, val]) => {
      T(60, y, `${l}: ${val}`, { size: 22 });
      y += 32;
    });
    y += 12;
    buyerLines.forEach((l, k) => T(60, y + k * 32, l, { size: 22, bold: k === 0 }));
    y += buyerLines.length * 32 + 20;
  }
  if (s.gstinRow && s.seller.gstin && s.buyer?.gstin) {
    T(60, y, `Supplier GSTIN: ${s.seller.gstin}`, { size: 22 });
    T(660, y, `Recipient GSTIN: ${s.buyer.gstin}`, { size: 22 });
    y += 44;
  }

  // Items table
  const cols = s.lang === "hi" ? ["क्र.", "विवरण", "HSN", "मात्रा", "दर", "राशि"] : ["S.No", "Description", "HSN", "Qty", "Rate", "Amount"];
  const cx = [60, 140, 620, 760, 900, 1180];
  els.push({ kind: "rect", x: 40, y: y - 30, w: W - 80, h: 44, fill: "#eeeeee" });
  cols.forEach((c, k) => T(cx[k], y, c, { size: 21, bold: true, anchor: k >= 3 ? "end" : "start" }));
  y += 44;
  let sub = 0;
  s.items.forEach((it, k) => {
    const amt = it.qty * it.rate * 100;
    sub += amt;
    T(cx[0], y, String(k + 1), { size: 21 });
    T(cx[1], y, it.desc, { size: 21 });
    T(cx[2], y, it.hsn, { size: 21 });
    T(cx[3], y, String(it.qty), { size: 21, anchor: "end" });
    T(cx[4], y, inr(it.rate * 100), { size: 21, anchor: "end" });
    T(cx[5], y, inr(amt), { size: 21, anchor: "end" });
    y += 36;
  });
  els.push({ kind: "line", x1: 40, y1: y - 18, x2: W - 40, y2: y - 18, stroke: "#999" });
  y += 20;

  const totals: [string, number][] = [];
  const subLabel = s.lang === "hi" ? "कर योग्य राशि" : "Sub Total";
  let tax = 0;
  if (s.tax !== "none") totals.push([subLabel, sub]);
  if (s.tax === "intra") {
    const half = Math.round(sub * 0.09);
    totals.push(["CGST @ 9%", half], ["SGST @ 9%", half]);
    tax = half * 2;
  } else if (s.tax === "inter") {
    tax = Math.round(sub * 0.18);
    totals.push(["IGST @ 18%", tax]);
  }
  const total = sub + tax;
  for (const e of s.extraTotals ?? []) totals.push([e.label, e.paise]);
  if (!s.noGrandTotal) totals.push([s.totalLabel, total]);
  for (const [l, p] of totals) {
    const bold = l === s.totalLabel;
    T(700, y, l, { size: 22, bold });
    T(1180, y, `${bold && s.lang !== "hi" ? "₹ " : ""}${inr(p)}`, { size: 22, bold, anchor: "end" });
    y += 34;
  }
  y += 16;
  if (s.showWords) {
    T(60, y, `${s.lang === "hi" ? "शब्दों में" : "Amount in words"}: ${inWords(total)}`, { size: 20 });
    y += 34;
  }
  if (s.terms) {
    T(60, y, s.terms, { size: 20 });
    y += 34;
  }
  if (s.bankFooter) {
    T(60, y, s.bankFooter, { size: 20 });
    y += 34;
  }
  y += 40;
  T(780, y, `${s.lang === "hi" ? "कृते" : "For"} ${s.seller.name}`, { size: 22, bold: true });
  y += 70;
  T(860, y, s.lang === "hi" ? "हस्ताक्षर (प्राधिकृत)" : "Authorised Signatory", { size: 20 });
  y += 50;
  return { width: W, height: y, bg: "#ffffff", els };
}

const I0 = { vendorGstin: null, vendorName: null, invoiceNumber: null, invoiceDate: null, dueDate: null, totalPaise: null, creditDays: null };
type IExp = Partial<Record<keyof typeof I0, string | number | null>>;
const ie = (e: IExp): FixtureSpec["expected"] => ({ ...I0, ...e });
const tot = (items: Item[], tax: InvoiceSpec["tax"]) => {
  const sub = items.reduce((s, i) => s + i.qty * i.rate * 100, 0);
  return sub + (tax === "intra" ? Math.round(sub * 0.09) * 2 : tax === "inter" ? Math.round(sub * 0.18) : 0);
};

const ITEMS = {
  pharma: [
    { desc: "Paracetamol 500mg (Demo) x10", hsn: "3004", qty: 100, rate: 50 },
    { desc: "ORS Sachets (Demo)", hsn: "3004", qty: 200, rate: 25 },
  ],
  textile: [{ desc: "Cotton Fabric (Demo) - mtr", hsn: "5208", qty: 40, rate: 100 }],
  hindi: [
    { desc: "चावल (डेमो) 25 किग्रा", hsn: "1006", qty: 10, rate: 1500 },
    { desc: "दाल (डेमो) 1 किग्रा", hsn: "0713", qty: 50, rate: 100 },
  ],
  hardware: [
    { desc: "PVC Pipe 2in (Demo)", hsn: "3917", qty: 100, rate: 300 },
    { desc: "Ball Valve (Demo)", hsn: "8481", qty: 40, rate: 500 },
  ],
  foods: [{ desc: "Rice Flour (Demo) 50kg", hsn: "1102", qty: 80, rate: 2500 }],
  agro: [
    { desc: "Fertilizer Bag (Demo)", hsn: "3105", qty: 90, rate: 1046 },
    { desc: "Seeds Pack (Demo)", hsn: "1209", qty: 1, rate: 52 },
  ],
  kirana: [
    { desc: "आटा (डेमो) 10 किग्रा", hsn: "1101", qty: 20, rate: 400 },
  ],
  misc: [{ desc: "Packaging Material (Demo)", hsn: "4819", qty: 100, rate: 70 }],
  elec: [{ desc: "LED Bulb 9W (Demo)", hsn: "8539", qty: 120, rate: 100 }],
  meera: [{ desc: "Snacks Box (Demo)", hsn: "2106", qty: 24, rate: 100 }],
  bright: [{ desc: "Office Chairs (Demo)", hsn: "9401", qty: 5, rate: 3000 }],
  lakshmi: [{ desc: "Steel Utensils Set (Demo)", hsn: "7323", qty: 50, rate: 800 }],
  patel: [{ desc: "Cleaning Supplies (Demo)", hsn: "3402", qty: 70, rate: 100 }],
  goods: [{ desc: "Tools Kit (Demo)", hsn: "8205", qty: 10, rate: 500 }],
};

const INVOICES: InvoiceSpec[] = [
  {
    id: "i01-tally-style",
    description: "PDF, Tally-like: seller header, Bill To with buyer GSTIN, CGST/SGST, words, due date",
    format: "pdf",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Sunrise Pharma Distributors (Demo)", address: "Shop 4, Demo Market, Andheri East, Mumbai 400069", gstin: G.sunrise, phone: "9876543210" },
    meta: "right",
    invNoLabel: "Invoice No",
    invNo: "SPD/24-25/0118",
    dateLabel: "Date",
    dateText: "12/03/2025",
    dueLabel: "Due Date",
    dueText: "11/04/2025",
    buyer: { label: "Bill To:", name: "Om Medical Store (Demo)", gstin: G.om },
    items: ITEMS.pharma,
    tax: "intra",
    totalLabel: "Grand Total",
    showWords: true,
    expected: ie({ vendorGstin: G.sunrise, vendorName: "Sunrise Pharma Distributors (Demo)", invoiceNumber: "SPD/24-25/0118", invoiceDate: "2025-03-12", dueDate: "2025-04-11", totalPaise: tot(ITEMS.pharma, "intra") }),
  },
  {
    id: "i02-retail-net30",
    description: "PDF, 'Invoice #', '5 Mar 2025', IGST, Net 30 terms, no printed due date",
    format: "pdf",
    lang: "en",
    title: "INVOICE",
    seller: { name: "Bluewave Textiles (Demo)", address: "12 Ring Road, Surat, Gujarat 395002", gstin: G.blue },
    meta: "stacked",
    invNoLabel: "Invoice #",
    invNo: "1187",
    dateLabel: "Date",
    dateText: "5 Mar 2025",
    buyer: { label: "Bill To:", name: "Walk-in Customer (Demo)" },
    items: ITEMS.textile,
    tax: "inter",
    totalLabel: "Total Amount",
    terms: "Payment terms: Net 30 days",
    expected: ie({ vendorGstin: G.blue, vendorName: "Bluewave Textiles (Demo)", invoiceNumber: "1187", invoiceDate: "2025-03-05", totalPaise: tot(ITEMS.textile, "inter"), creditDays: 30 }),
  },
  {
    id: "i03-hindi-pdf",
    description: "PDF, Hindi: बिल संख्या / दिनांक / देय तिथि / कुल राशि, buyer खरीदार",
    format: "pdf",
    lang: "hi",
    title: "कर बीजक",
    seller: { name: "श्री गणेश ट्रेडर्स (डेमो)", address: "मुख्य बाज़ार, लखनऊ 226001", gstin: G.ganesh },
    sellerGstinLabel: "जीएसटी नंबर",
    meta: "stacked",
    invNoLabel: "बिल संख्या",
    invNo: "0425",
    dateLabel: "दिनांक",
    dateText: "15/02/2025",
    dueLabel: "देय तिथि",
    dueText: "17/03/2025",
    buyer: { label: "खरीदार:", name: "ओम मेडिकल स्टोर (डेमो)", gstin: G.om, gstinLabel: "जीएसटी नंबर" },
    items: ITEMS.hindi,
    tax: "intra",
    totalLabel: "कुल राशि",
    expected: ie({ vendorGstin: G.ganesh, vendorName: "श्री गणेश ट्रेडर्स (डेमो)", invoiceNumber: "0425", invoiceDate: "2025-02-15", dueDate: "2025-03-17", totalPaise: tot(ITEMS.hindi, "intra") }),
  },
  {
    id: "i04-column-header",
    description: "PDF, meta in column-header layout (labels row, values row below)",
    format: "pdf",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Delta Hardware (Demo)", address: "45 Industrial Area, Bengaluru 560058", gstin: G.delta },
    meta: "columns",
    invNoLabel: "Invoice No.",
    invNo: "GST/0425",
    dateLabel: "Invoice Date",
    dateText: "02-Apr-2025",
    dueLabel: "Due Date",
    dueText: "02-May-2025",
    buyer: { label: "Billed To:", name: "Laxmi Stores (Demo)", gstin: G.laxmi },
    items: ITEMS.hardware,
    tax: "inter",
    totalLabel: "Total Amount",
    showWords: true,
    expected: ie({ vendorGstin: G.delta, vendorName: "Delta Hardware (Demo)", invoiceNumber: "GST/0425", invoiceDate: "2025-04-02", dueDate: "2025-05-02", totalPaise: tot(ITEMS.hardware, "inter") }),
  },
  {
    id: "i05-supplier-recipient-row",
    description: "PDF, 'Supplier GSTIN … Recipient GSTIN …' on one row; lakh-grouped total",
    format: "pdf",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Kaveri Foods (Demo)", address: "8 Mill Road, Coimbatore 641001", gstin: G.kaveri },
    gstinRow: true,
    meta: "stacked",
    invNoLabel: "Invoice No",
    invNo: "KF/2025/077",
    dateLabel: "Invoice Date",
    dateText: "31-03-2025",
    buyer: { label: "Ship To:", name: "TArrow Demo Mart", gstin: G.tarrow },
    items: ITEMS.foods,
    tax: "inter",
    totalLabel: "Grand Total",
    expected: ie({ vendorGstin: G.kaveri, vendorName: "Kaveri Foods (Demo)", invoiceNumber: "KF/2025/077", invoiceDate: "2025-03-31", totalPaise: tot(ITEMS.foods, "inter") }),
  },
  {
    id: "i06-iso-dates-lakh",
    description: "PDF, ISO dates, 'Total Payable' in lakhs with paise",
    format: "pdf",
    lang: "en",
    title: "INVOICE",
    seller: { name: "Annapurna Agro Foods (Demo)", address: "Plot 9, Agro Estate, Nashik 422001", gstin: G.anna },
    meta: "right",
    invNoLabel: "Invoice No",
    invNo: "INV-2025-0042",
    dateLabel: "Invoice Date",
    dateText: "2025-03-31",
    dueLabel: "Due Date",
    dueText: "2025-04-30",
    buyer: { label: "Bill To:", name: "Om Medical Store (Demo)", gstin: G.om },
    items: ITEMS.agro,
    tax: "none",
    totalLabel: "Total Payable",
    showWords: true,
    expected: ie({ vendorGstin: G.anna, vendorName: "Annapurna Agro Foods (Demo)", invoiceNumber: "INV-2025-0042", invoiceDate: "2025-03-31", dueDate: "2025-04-30", totalPaise: tot(ITEMS.agro, "none") }),
  },
  {
    id: "i07-ambiguous-totals",
    description: "PDF, two section totals and no grand total → total must be null",
    format: "pdf",
    lang: "en",
    title: "BILL",
    seller: { name: "Patel Brothers (Demo)", address: "Station Road, Vadodara 390001", gstin: G.patel },
    meta: "stacked",
    invNoLabel: "Bill No",
    invNo: "7781",
    dateLabel: "Date",
    dateText: "08/01/2025",
    items: ITEMS.goods,
    tax: "none",
    totalLabel: "Total",
    noGrandTotal: true,
    extraTotals: [
      { label: "Total (Goods)", paise: 500000 },
      { label: "Total (Services)", paise: 750000 },
    ],
    expected: ie({ vendorGstin: G.patel, vendorName: "Patel Brothers (Demo)", invoiceNumber: "7781", invoiceDate: "2025-01-08" }),
    candidates: { totalPaise: [500000, 750000] },
  },
  {
    id: "i08-png-standard",
    description: "PNG, standard English tax invoice",
    format: "png",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Kaveri Foods (Demo)", address: "8 Mill Road, Coimbatore 641001", gstin: G.kaveri, phone: "9443322110" },
    meta: "right",
    invNoLabel: "Invoice No",
    invNo: "KF-1029",
    dateLabel: "Date",
    dateText: "21/03/2025",
    dueLabel: "Due Date",
    dueText: "20/04/2025",
    buyer: { label: "Bill To:", name: "Laxmi Stores (Demo)", gstin: G.laxmi },
    items: ITEMS.foods,
    tax: "intra",
    totalLabel: "Grand Total",
    showWords: true,
    expected: ie({ vendorGstin: G.kaveri, vendorName: "Kaveri Foods (Demo)", invoiceNumber: "KF-1029", invoiceDate: "2025-03-21", dueDate: "2025-04-20", totalPaise: tot(ITEMS.foods, "intra") }),
  },
  {
    id: "i09-photo-credit15",
    description: "JPEG photo-like (rotated, noisy, blurred); 'Credit: 15 days'",
    format: "jpg",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Patel Brothers (Demo)", address: "Station Road, Vadodara 390001", gstin: G.patel },
    meta: "stacked",
    invNoLabel: "Invoice No",
    invNo: "PB/0907",
    dateLabel: "Date",
    dateText: "09-Mar-2025",
    buyer: { label: "Bill To:", name: "Laxmi Stores (Demo)" },
    items: ITEMS.patel,
    tax: "inter",
    totalLabel: "Grand Total",
    terms: "Credit: 15 days",
    degrade: { rotate: 1.3, noise: 30, blur: 0.7, jpeg: 68 },
    expected: ie({ vendorGstin: G.patel, vendorName: "Patel Brothers (Demo)", invoiceNumber: "PB/0907", invoiceDate: "2025-03-09", totalPaise: tot(ITEMS.patel, "inter"), creditDays: 15 }),
  },
  {
    id: "i10-hindi-png",
    description: "PNG, Hindi invoice (Devanagari OCR)",
    format: "png",
    lang: "hi",
    title: "कर बीजक",
    seller: { name: "अन्नपूर्णा किराना (डेमो)", address: "चौक बाज़ार, कानपुर 208001", gstin: G.anna },
    sellerGstinLabel: "जीएसटी नंबर",
    meta: "stacked",
    invNoLabel: "बिल नंबर",
    invNo: "AK-221",
    dateLabel: "दिनांक",
    dateText: "04/02/2025",
    dueLabel: "देय तिथि",
    dueText: "06/03/2025",
    items: ITEMS.kirana,
    tax: "intra",
    totalLabel: "कुल राशि",
    expected: ie({ vendorGstin: G.anna, vendorName: "अन्नपूर्णा किराना (डेमो)", invoiceNumber: "AK-221", invoiceDate: "2025-02-04", dueDate: "2025-03-06", totalPaise: tot(ITEMS.kirana, "intra") }),
  },
  {
    id: "i11-ordinal-dates",
    description: "PNG, '1st February 2025', 'Balance Due', 'Payment due by 3rd March 2025'",
    format: "png",
    lang: "en",
    title: "INVOICE",
    seller: { name: "Ganesh Electricals (Demo)", address: "22 Lamington Road, Mumbai 400007", gstin: G.electricals },
    meta: "stacked",
    invNoLabel: "Invoice No",
    invNo: "GE/101",
    dateLabel: "Date",
    dateText: "1st February 2025",
    dueLabel: "Payment due by",
    dueText: "3rd March 2025",
    buyer: { label: "Customer:", name: "Om Medical Store (Demo)", gstin: G.om },
    items: ITEMS.elec,
    tax: "intra",
    totalLabel: "Balance Due",
    expected: ie({ vendorGstin: G.electricals, vendorName: "Ganesh Electricals (Demo)", invoiceNumber: "GE/101", invoiceDate: "2025-02-01", dueDate: "2025-03-03", totalPaise: tot(ITEMS.elec, "intra") }),
  },
  {
    id: "i12-buyer-gstin-only",
    description: "PNG, unregistered seller (Bill of Supply); only buyer GSTIN → vendor GSTIN null",
    format: "png",
    lang: "en",
    title: "BILL OF SUPPLY",
    seller: { name: "Meera Foods (Demo)", address: "Lane 3, Koregaon Park, Pune 411001", phone: "9822001122" },
    meta: "stacked",
    invNoLabel: "Bill No",
    invNo: "MF-55",
    dateLabel: "Date",
    dateText: "10/03/2025",
    buyer: { label: "Bill To:", name: "Om Medical Store (Demo)", gstin: G.om },
    items: ITEMS.meera,
    tax: "none",
    totalLabel: "Total",
    expected: ie({ vendorName: "Meera Foods (Demo)", invoiceNumber: "MF-55", invoiceDate: "2025-03-10", totalPaise: tot(ITEMS.meera, "none") }),
  },
  {
    id: "i13-combined-no-date",
    description: "PNG, 'Invoice No & Date: TI-00042 dt. 07/01/2025', bank footer, Amount Payable",
    format: "png",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Bright Star Enterprises (Demo)", address: "Unit 7, Demo Estate, Thane 400601", gstin: G.bright },
    meta: "combined",
    invNoLabel: "Invoice No & Date",
    invNo: "TI-00042",
    dateLabel: "dt.",
    dateText: "07/01/2025",
    buyer: { label: "Buyer:", name: "Laxmi Stores (Demo)", gstin: G.laxmi },
    items: ITEMS.bright,
    tax: "intra",
    totalLabel: "Amount Payable",
    showWords: true,
    bankFooter: "Bank: HDFC Bank  A/c No: 50200012345678  IFSC: HDFC0004321",
    expected: ie({ vendorGstin: G.bright, vendorName: "Bright Star Enterprises (Demo)", invoiceNumber: "TI-00042", invoiceDate: "2025-01-07", totalPaise: tot(ITEMS.bright, "intra") }),
  },
  {
    id: "i14-gstin-row-png",
    description: "PNG, supplier/recipient GSTIN on one row, 'Dated: 28.02.2025'",
    format: "png",
    lang: "en",
    title: "TAX INVOICE",
    seller: { name: "Lakshmi Agencies (Demo)", address: "14 Anna Salai, Chennai 600002", gstin: G.lakshmi },
    gstinRow: true,
    meta: "stacked",
    invNoLabel: "Invoice No",
    invNo: "LA/24-25/310",
    dateLabel: "Dated",
    dateText: "28.02.2025",
    dueLabel: "Due Date",
    dueText: "30.03.2025",
    buyer: { label: "Bill To:", name: "TArrow Demo Mart", gstin: G.tarrow },
    items: ITEMS.lakshmi,
    tax: "inter",
    totalLabel: "Grand Total",
    expected: ie({ vendorGstin: G.lakshmi, vendorName: "Lakshmi Agencies (Demo)", invoiceNumber: "LA/24-25/310", invoiceDate: "2025-02-28", dueDate: "2025-03-30", totalPaise: tot(ITEMS.lakshmi, "inter") }),
  },
  {
    id: "i15-receipt-narrow",
    description: "PNG, narrow thermal-receipt style, monospace, 'NET AMOUNT', 'Dt: 18/03/25'",
    format: "png",
    lang: "en",
    title: "CASH MEMO",
    seller: { name: "Sharma General Store (Demo)", address: "Karol Bagh, New Delhi 110005", gstin: G.sharma },
    meta: "stacked",
    invNoLabel: "Bill No",
    invNo: "3345",
    dateLabel: "Dt",
    dateText: "18/03/25",
    items: [{ desc: "Grocery items (Demo)", hsn: "1905", qty: 25, rate: 50 }],
    tax: "none",
    totalLabel: "NET AMOUNT",
    expected: ie({ vendorGstin: G.sharma, vendorName: "Sharma General Store (Demo)", invoiceNumber: "3345", invoiceDate: "2025-03-18", totalPaise: 125000 }),
  },
];

function receiptPage(s: InvoiceSpec): Page {
  const W = 600;
  const els: El[] = [];
  const M = (y: number, text: string, o: Partial<TextEl> = {}) => els.push(t(30, y, text, { font: "mono", size: 22, ...o }));
  let y = 60;
  M(y, s.seller.name.toUpperCase(), { bold: true, size: 24 });
  y += 34;
  M(y, s.seller.address, { size: 18 });
  y += 30;
  if (s.seller.gstin) M(y, `GSTIN: ${s.seller.gstin}`, { size: 20 });
  y += 40;
  M(y, s.title, { bold: true });
  y += 36;
  M(y, `${s.invNoLabel}: ${s.invNo}`);
  M(y, `${s.dateLabel}: ${s.dateText}`, { x: 330 });
  y += 30;
  M(y, "-".repeat(40), { decorative: true });
  y += 30;
  for (const it of s.items) {
    M(y, it.desc, { size: 20 });
    y += 28;
    M(y, `  ${it.qty} x ${inr(it.rate * 100)}`, { size: 20 });
    els.push(t(570, y, inr(it.qty * it.rate * 100), { font: "mono", size: 20, anchor: "end" }));
    y += 32;
  }
  M(y, "-".repeat(40), { decorative: true });
  y += 34;
  const total = s.items.reduce((a, i) => a + i.qty * i.rate * 100, 0);
  M(y, s.totalLabel, { bold: true });
  els.push(t(570, y, inr(total), { font: "mono", size: 22, anchor: "end", bold: true }));
  y += 50;
  M(y, "Thank you! Visit again", { size: 18 });
  y += 30;
  return { width: W, height: y + 20, bg: "#fbfaf7", els };
}

// ───────────────────────── main ─────────────────────────

async function main() {
  if (existsSync(OUT)) {
    for (const f of readdirSync(OUT)) rmSync(path.join(OUT, f));
  } else mkdirSync(OUT, { recursive: true });
  for (const f of Object.values(FONTS)) if (!existsSync(f)) console.warn(`[fixtures] font missing: ${f} (rendering falls back)`);

  const specs: FixtureSpec[] = [];
  for (const vt of VENDOR_TEXT) {
    const file = `${vt.id}.txt`;
    writeFileSync(path.join(OUT, file), vt.text + "\n");
    specs.push({ id: vt.id, kind: "vendor", sourceType: "paste", file, lang: vt.lang, description: vt.description, expected: vt.expected, candidates: vt.candidates });
  }
  let seed = 7;
  for (const vi of VENDOR_IMAGES) {
    const ext = vi.degrade?.jpeg ? "jpg" : "png";
    const file = `${vi.id}.${ext}`;
    await renderImage(vi.page, file, vi.degrade, seed++);
    specs.push({ id: vi.id, kind: "vendor", sourceType: "image", file, lang: vi.lang, description: vi.description, expected: vi.expected, candidates: vi.candidates, groundTruthText: truthText(vi.page) });
  }
  for (const inv of INVOICES) {
    const page = inv.id.includes("receipt") ? receiptPage(inv) : invoicePage(inv);
    const file = `${inv.id}.${inv.format}`;
    if (inv.format === "pdf") await renderPdf(page, file, inv.lang === "hi");
    else await renderImage(page, file, inv.degrade, seed++);
    specs.push({
      id: inv.id,
      kind: "invoice",
      sourceType: inv.format === "pdf" ? "pdf" : "image",
      file,
      lang: inv.lang,
      description: inv.description,
      expected: inv.expected,
      candidates: inv.candidates as FixtureSpec["candidates"],
      groundTruthText: truthText(page),
    });
  }
  for (const s of specs) writeFileSync(path.join(OUT, `${s.id}.expected.json`), JSON.stringify(s, null, 2) + "\n");
  const bytes = readdirSync(OUT).reduce((a, f) => a + readFileSync(path.join(OUT, f)).length, 0);
  console.log(`[fixtures] wrote ${specs.length} fixtures (${(bytes / 1024).toFixed(0)} KB) to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
