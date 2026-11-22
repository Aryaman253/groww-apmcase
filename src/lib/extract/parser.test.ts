import { describe, expect, it } from "vitest";
import { gstinCheckChar } from "../validation";
import { amountWordsToPaise } from "./amount-words";
import { looksGarbledDevanagari, normalizeLine } from "./normalize";
import { CONFIDENT, PARSER_VERSION, cleanName, parseInvoiceText, parseVendorText } from "./parser";
import { mergeReadingOrder } from "../ocr/reading-order";
import { pdfItemsToText } from "../ocr/pdf-text";

const gstin = (state: string, pan: string, entity = "1") => {
  const f = `${state}${pan}${entity}Z`;
  return f + gstinCheckChar(f);
};
const G1 = gstin("27", "AAKFS1234Q");
const G2 = gstin("27", "AAEPO2222L");

describe("PARSER_VERSION", () => {
  it("is semver", () => expect(PARSER_VERSION).toMatch(/^\d+\.\d+\.\d+$/));
});

describe("normalize", () => {
  it("converts Devanagari digits and strips emojis", () => {
    expect(normalizeLine("खाता ३४५६ 👍")).toBe("खाता 3456");
  });
  it("turns phone emojis into a phone label", () => {
    expect(normalizeLine("📞 98765 43210")).toContain("Ph:");
  });
  it("joins OCR-spaced UPI handles", () => {
    expect(normalizeLine("UPI: demo @ ybl")).toBe("UPI: demo@ybl");
  });
  it("reorders visually-ordered ि from PDF text layers", () => {
    expect(normalizeLine("िबल संख्या")).toBe("बिल संख्या");
    expect(normalizeLine("देय ितिथ")).toBe("देय तिथि");
  });
  it("detects garbled Devanagari", () => {
    expect(looksGarbledDevanagari("गणेश ट ेडसर्")).toBe(true);
    expect(looksGarbledDevanagari("गणेश ट्रेडर्स")).toBe(false);
  });
});

describe("parseVendorText — accounts", () => {
  it("reads a labelled account with spaces inside the number", () => {
    const r = parseVendorText("A/c No: 1234 5678 9012\nIFSC: HDFC0001234");
    expect(r.accountNumber.value).toBe("123456789012");
    expect(r.accountNumber.confidence).toBeGreaterThanOrEqual(CONFIDENT);
    expect(r.accountNumber.source).toBe("text");
  });

  it.each([
    ["Acc no:-112233445566", "112233445566"],
    ["Account Number: 000405001234", "000405001234"],
    ["acc no:- 0123 4567 8901 23", "01234567890123"],
    ["Khata no 3456 7890 1234", "345678901234"],
    ["खाता संख्या: 000123456789012", "000123456789012"],
    ["खाता नं. ३४५६७८९०१२३४", "345678901234"],
    ["Current A/c 0011223344556", "0011223344556"],
    ["A/c-50100012345678", "50100012345678"],
  ])("keyword variant %s", (text, want) => {
    expect(parseVendorText(text).accountNumber.value).toBe(want);
  });

  it("reads the value on the line after a bare label", () => {
    expect(parseVendorText("💳 A/c:\n9180 1000 2233 4455").accountNumber.value).toBe("9180100022334455");
  });

  it("never guesses between two unlabelled numbers", () => {
    const r = parseVendorText("Pay in 112200334455 or 998877001122");
    expect(r.accountNumber.value).toBeNull();
    expect(r.accountNumber.confidence).toBe(0);
    expect(r.accountNumber.candidates).toEqual(expect.arrayContaining(["112200334455", "998877001122"]));
  });

  it("never guesses between two labelled accounts", () => {
    const r = parseVendorText("HDFC A/c: 123400005678 IFSC HDFC0000123\nSBI A/c: 300012345678 IFSC SBIN0011223");
    expect(r.accountNumber.value).toBeNull();
    expect(r.ifsc.value).toBeNull();
    expect(r.bankName.value).toBeNull();
    expect(r.ifsc.candidates).toHaveLength(2);
  });

  it("prefers the labelled number over an unlabelled one", () => {
    const r = parseVendorText("Note 998877665544\nA/c No 112233445566");
    expect(r.accountNumber.value).toBe("112233445566");
    expect(r.accountNumber.candidates).toEqual(["112233445566", "998877665544"]);
  });

  it("a single unlabelled number is filled but not confident", () => {
    const r = parseVendorText("Ramesh Demo Traders\n123456789012\nICIC0001234");
    expect(r.accountNumber.value).toBe("123456789012");
    expect(r.accountNumber.confidence).toBeLessThan(CONFIDENT);
  });

  it("does not mistake phone numbers for accounts", () => {
    for (const t of ["Mob 9876543210", "9876543210", "+91 98765 43210", "Paytm / GPay: 9876501234", "Call 98765-43210"]) {
      const r = parseVendorText(t);
      expect(r.accountNumber.value, t).toBeNull();
      expect(r.phone.value, t).toMatch(/^[6-9]\d{9}$/);
    }
  });

  it("a phone-shaped number labelled as account is kept but not confident", () => {
    const r = parseVendorText("A/c No: 9876543210 (Paytm Payments Bank)");
    expect(r.accountNumber.value).toBe("9876543210");
    expect(r.accountNumber.confidence).toBeLessThan(CONFIDENT);
    expect(r.phone.value).toBeNull();
  });

  it("ignores Aadhaar, customer ID, MICR, PAN, GSTIN, IFSC, UPI and email digits", () => {
    const r = parseVendorText(
      `Aadhaar: 1234 5678 9012\nCustomer ID: 123456789\nMICR: 400240015\nPAN: AAJFD4321M\nGSTIN: ${G1}\nIFSC: SBIN0001234\nUPI: 987654321012@ybl\nrk123456789012@gmail.com`,
    );
    expect(r.accountNumber.value).toBeNull();
    expect(r.accountNumber.candidates).toEqual([]);
  });

  it("ignores invoice numbers, dates and amounts", () => {
    const r = parseVendorText("Bill No 2025004512 dt 03/04/2025 amount ₹12,50,000.00\nPay to A/c 445566778899");
    expect(r.accountNumber.value).toBe("445566778899");
    expect(r.accountNumber.candidates).toEqual(["445566778899"]);
  });

  it("ignores a cheque MICR band", () => {
    const r = parseVendorText('A/c No. 50200012345678\n"000123" 411240015: 004321" 31');
    expect(r.accountNumber.value).toBe("50200012345678");
  });
});

describe("parseVendorText — other fields", () => {
  it("IFSC: lowercase, spaced and OCR O/0 fixes", () => {
    expect(parseVendorText("ifsc - cnrb0001234").ifsc.value).toBe("CNRB0001234");
    expect(parseVendorText("IFSC: HDFC 0001234").ifsc.value).toBe("HDFC0001234");
    const ocr = parseVendorText("IFS Code: SBINO012345", { ocrWordConfidence: 0.95 });
    expect(ocr.ifsc.value).toBe("SBIN0012345");
    expect(ocr.ifsc.evidence).toContain("ocr-corrected");
    expect(ocr.ifsc.confidence).toBeLessThan(CONFIDENT + 0.01);
  });

  it("bank name from text, IFSC prefix and their agreement/conflict", () => {
    expect(parseVendorText("IFSC: UTIB0000123").bankName).toMatchObject({ value: "Axis Bank" });
    const agree = parseVendorText("Bank: HDFC Bank, Andheri\nIFSC: HDFC0001234").bankName;
    expect(agree.value).toBe("HDFC Bank");
    expect(agree.confidence).toBeGreaterThan(0.9);
    const conflict = parseVendorText("Bank: State Bank of India\nIFSC: HDFC0001234").bankName;
    expect(conflict.value).toBeNull();
    expect(conflict.candidates).toEqual(expect.arrayContaining(["HDFC Bank", "State Bank of India"]));
    expect(parseVendorText("बैंक: पंजाब नेशनल बैंक").bankName.value).toBe("Punjab National Bank");
  });

  it("holder name: English, Hinglish, Hindi labels; bank name label is not a holder label", () => {
    expect(parseVendorText("Name: Sunrise Pharma (Demo)\nBank Name: ICICI Bank").accountHolderName.value).toBe("Sunrise Pharma (Demo)");
    expect(parseVendorText("Naam: Gupta Kirana Store (Demo)").accountHolderName.value).toBe("Gupta Kirana Store (Demo)");
    expect(parseVendorText("खाता धारक: श्याम ट्रेडर्स (डेमो)").accountHolderName.value).toBe("श्याम ट्रेडर्स (डेमो)");
    expect(parseVendorText("Beneficiary Name: M/s Bluewave Textiles").accountHolderName.value).toBe("Bluewave Textiles");
    expect(parseVendorText("Bank Name: ICICI Bank").accountHolderName.value).toBeNull();
  });

  it("holder name: two different labelled names are ambiguous", () => {
    const r = parseVendorText("A/c Name: Alpha Traders (Demo)\nBeneficiary: Beta Stores (Demo)");
    expect(r.accountHolderName.value).toBeNull();
    expect(r.accountHolderName.candidates).toHaveLength(2);
  });

  it("holder name from a cheque signature block", () => {
    const r = parseVendorText("For BRIGHT STAR ENTERPRISES (DEMO)\nAuthorised Signatory");
    expect(r.accountHolderName.value).toBe("BRIGHT STAR ENTERPRISES (DEMO)");
    expect(r.accountHolderName.confidence).toBeLessThan(CONFIDENT);
  });

  it("UPI: known handle, email is not UPI, two ids are ambiguous", () => {
    expect(parseVendorText("UPI: sunrisedemo@okhdfcbank").upiId).toMatchObject({ value: "sunrisedemo@okhdfcbank" });
    const r = parseVendorText("Email - a.b@gmail.com");
    expect(r.upiId.value).toBeNull();
    expect(r.email.value).toBe("a.b@gmail.com");
    const two = parseVendorText("GPay: demo1@okaxis or PhonePe: demo2@ybl");
    expect(two.upiId.value).toBeNull();
    expect(two.upiId.candidates).toHaveLength(2);
  });

  it("GSTIN: checksum validated; invalid checksum is rejected; OCR confusions fixed", () => {
    expect(parseVendorText(`GSTIN: ${G1}`).gstin.value).toBe(G1);
    const bad = G1.slice(0, 14) + (G1[14] === "A" ? "B" : "A");
    expect(parseVendorText(`GSTIN: ${bad}`).gstin.value).toBeNull();
    const ocrish = G1.replace(/^27/, "Z7").replace("1234", "I234");
    const r = parseVendorText(`GSTIN: ${ocrish}`, { ocrWordConfidence: 0.9 });
    expect(r.gstin.value).toBe(G1);
    expect(r.gstin.evidence).toContain("ocr-corrected");
  });

  it("two different phone numbers are ambiguous", () => {
    const r = parseVendorText("Mob: 9876543210, 9123456789");
    expect(r.phone.value).toBeNull();
    expect(r.phone.candidates).toHaveLength(2);
  });

  it("empty / irrelevant text yields all nulls", () => {
    const r = parseVendorText("Hello, will share details tomorrow 🙏");
    for (const f of Object.values(r)) {
      expect(f.value).toBeNull();
      expect(f.confidence).toBe(0);
    }
  });

  it("low OCR line confidence caps confidence below CONFIDENT", () => {
    const r = parseVendorText("A/c No: 112233445566", { ocrLineConfidences: [0.7] });
    expect(r.accountNumber.value).toBe("112233445566");
    expect(r.accountNumber.source).toBe("ocr");
    expect(r.accountNumber.confidence).toBeLessThan(CONFIDENT);
  });

  it("is deterministic", () => {
    const t = "Name: X Traders\nA/c 112233445566\nIFSC SBIN0001234";
    expect(parseVendorText(t)).toEqual(parseVendorText(t));
  });
});

const INVOICE = `SUNRISE PHARMA DISTRIBUTORS (DEMO)
Shop 4, Demo Market, Mumbai 400069
GSTIN: ${G1}  Ph: 9876543210
TAX INVOICE
Bill To:  Invoice No: SPD/24-25/0118
Om Medical Store (Demo)  Date: 12/03/2025
GSTIN: ${G2}  Due Date: 11/04/2025
S.No Description HSN Qty Rate Amount
1 Paracetamol (Demo) 3004 100 50.00 5,000.00
2 ORS (Demo) 3004 200 25.00 5,000.00
Total 300 10,000.00
Sub Total 10,000.00
CGST @ 9% 900.00
SGST @ 9% 900.00
Grand Total ₹ 11,800.00
Amount in words: Rupees Eleven Thousand Eight Hundred Only
For SUNRISE PHARMA DISTRIBUTORS (DEMO)
Authorised Signatory`;

describe("parseInvoiceText", () => {
  const r = parseInvoiceText(INVOICE);
  it("seller GSTIN (not the buyer's)", () => {
    expect(r.vendorGstin.value).toBe(G1);
    expect(r.vendorGstin.confidence).toBeGreaterThanOrEqual(CONFIDENT);
  });
  it("vendor name from header + signature agreement", () => {
    expect(r.vendorName.value).toBe("SUNRISE PHARMA DISTRIBUTORS (DEMO)");
    expect(r.vendorName.confidence).toBeGreaterThanOrEqual(CONFIDENT);
  });
  it("invoice number, dates", () => {
    expect(r.invoiceNumber.value).toBe("SPD/24-25/0118");
    expect(r.invoiceDate.value).toBe("2025-03-12");
    expect(r.dueDate.value).toBe("2025-04-11");
  });
  it("grand total wins over item-table total; corroborated by words and tax sum", () => {
    expect(r.totalPaise.value).toBe(1180000);
    expect(r.totalPaise.evidence).toEqual(expect.arrayContaining(["matches-words", "matches-subtotal+tax"]));
  });
  it("ownGstin is excluded", () => {
    const own = parseInvoiceText(`GSTIN: ${G1}\nGSTIN: ${G2}`, { ownGstin: G1 });
    expect(own.vendorGstin.value).toBe(G2);
  });
  it("only a buyer GSTIN → null vendor GSTIN", () => {
    const b = parseInvoiceText(`Meera Foods (Demo)\nBill No: MF-55\nBill To:\nOm Medical (Demo)\nGSTIN: ${G2}\nTotal ₹ 2,400.00`);
    expect(b.vendorGstin.value).toBeNull();
    expect(b.totalPaise.value).toBe(240000);
    expect(b.invoiceNumber.value).toBe("MF-55");
  });
  it("supplier/recipient GSTINs on one row", () => {
    const x = parseInvoiceText(`Supplier GSTIN: ${G1}   Recipient GSTIN: ${G2}`);
    expect(x.vendorGstin.value).toBe(G1);
  });
  it("column-header meta layout", () => {
    const x = parseInvoiceText("Invoice No.  Invoice Date  Due Date\nGST/0425  02-Apr-2025  02-May-2025");
    expect(x.invoiceNumber.value).toBe("GST/0425");
    expect(x.invoiceDate.value).toBe("2025-04-02");
    expect(x.dueDate.value).toBe("2025-05-02");
  });
  it("Hindi labels and Hindi month names", () => {
    const x = parseInvoiceText("बिल संख्या: 0425\nदिनांक: 15 मार्च 2025\nदेय तिथि: 14/04/2025\nकुल राशि: ₹ 23,600.00");
    expect(x.invoiceNumber.value).toBe("0425");
    expect(x.invoiceDate.value).toBe("2025-03-15");
    expect(x.dueDate.value).toBe("2025-04-14");
    expect(x.totalPaise.value).toBe(2360000);
  });
  it("invoice number + date combined label", () => {
    const x = parseInvoiceText("Invoice No & Date: TI-00042 dt. 07/01/2025");
    expect(x.invoiceNumber.value).toBe("TI-00042");
    expect(x.invoiceDate.value).toBe("2025-01-07");
  });
  it("e-way bill / PO numbers are not invoice numbers; invoice number is not an amount", () => {
    const x = parseInvoiceText("E-Way Bill No: 331000123456\nPO No: 4500012\nInvoice No: 1187\nTotal Amount: 4,720.00");
    expect(x.invoiceNumber.value).toBe("1187");
    expect(x.totalPaise.value).toBe(472000);
  });
  it("lakh amounts and lakh words", () => {
    const x = parseInvoiceText("Total Payable: ₹1,23,456.50\nRupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only");
    expect(x.totalPaise.value).toBe(12345650);
    expect(x.totalPaise.evidence).toContain("matches-words");
    expect(parseInvoiceText("bill amount 1.5 lakh").totalPaise.value).toBe(15000000);
  });
  it("two different section totals → null with candidates", () => {
    const x = parseInvoiceText("Total (Goods): 5,000.00\nTotal (Services): 7,500.00");
    expect(x.totalPaise.value).toBeNull();
    expect(x.totalPaise.candidates).toEqual(expect.arrayContaining([500000, 750000]));
  });
  it("OCR totals are confident only when corroborated", () => {
    const x = parseInvoiceText("Grand Total 11,800.00", { ocrWordConfidence: 0.99 });
    expect(x.totalPaise.value).toBe(1180000);
    expect(x.totalPaise.confidence).toBeLessThan(CONFIDENT);
  });
  it("OCR '₹' read as a leading digit is corrected via amount in words", () => {
    const x = parseInvoiceText("Grand Total 72,36,000.00\nAmount in words: Rupees Two Lakh Thirty Six Thousand Only", { ocrWordConfidence: 0.98 });
    expect(x.totalPaise.value).toBe(23600000);
  });
  it("OCR invoice numbers with I/l confusions are not confident", () => {
    const x = parseInvoiceText("Invoice No: Tl-00042", { ocrWordConfidence: 0.99 });
    expect(x.invoiceNumber.confidence).toBeLessThan(CONFIDENT);
  });
  it("credit days", () => {
    expect(parseInvoiceText("Payment terms: Net 30 days").creditDays.value).toBe(30);
    expect(parseInvoiceText("Credit: 15 days").creditDays.value).toBe(15);
  });
  it("due date before invoice date is flagged", () => {
    const x = parseInvoiceText("Invoice Date: 10/03/2025\nDue Date: 01/03/2025");
    expect(x.dueDate.confidence).toBeLessThan(CONFIDENT);
  });
});

describe("helpers", () => {
  it("amountWordsToPaise", () => {
    expect(amountWordsToPaise("Rupees Eleven Thousand Eight Hundred Only")).toBe(1180000);
    expect(amountWordsToPaise("INR Two Crore Five Lakh Only")).toBe(2050000000);
    expect(amountWordsToPaise("no amount here")).toBeNull();
  });
  it("cleanName", () => {
    expect(cleanName(" - M/s Ravi Traders (Demo), Mob")).toBe("Ravi Traders (Demo)");
    expect(cleanName("50100012345678")).toBeNull();
    expect(cleanName("x@y.com")).toBeNull();
  });
  it("mergeReadingOrder groups by row and sorts by x", () => {
    const lines = mergeReadingOrder([
      { text: "IFSC:", confidence: 0.9, box: { x: 10, y: 52, width: 60, height: 20 } },
      { text: "Name:", confidence: 0.9, box: { x: 10, y: 10, width: 60, height: 20 } },
      { text: "Demo", confidence: 0.8, box: { x: 80, y: 12, width: 50, height: 20 } },
      { text: "SBIN0001234", confidence: 0.95, box: { x: 80, y: 50, width: 120, height: 22 } },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["Name: Demo", "IFSC: SBIN0001234"]);
  });
  it("pdfItemsToText groups items by baseline", () => {
    const t = pdfItemsToText([
      { str: "Total", transform: [1, 0, 0, 1, 10, 100], width: 30, height: 10 },
      { str: "Invoice No: 42", transform: [1, 0, 0, 1, 10, 200], width: 80, height: 10 },
      { str: "11,800.00", transform: [1, 0, 0, 1, 300, 100], width: 50, height: 10 },
    ]);
    expect(t).toBe("Invoice No: 42\nTotal  11,800.00");
  });
});

describe("IFSC OCR look-alikes (browser regression)", () => {
  it("corrects O→0 in a numeric branch code but never with high confidence", () => {
    const r = parseVendorText("IFSC: SBIN0O12345", { ocrWordConfidence: 0.95 });
    expect(r.ifsc.value).toBe("SBIN0012345");
    expect(r.ifsc.confidence).toBeLessThan(0.8);
  });
  it("leaves clean IFSCs confident", () => {
    const r = parseVendorText("IFSC: SBIN0012345");
    expect(r.ifsc.value).toBe("SBIN0012345");
    expect(r.ifsc.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("does not touch genuinely alphanumeric branch codes", () => {
    expect(parseVendorText("IFSC: BARB0DEMOXX").ifsc.value).toBe("BARB0DEMOXX");
  });
});
