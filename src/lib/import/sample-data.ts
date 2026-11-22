import * as XLSX from "xlsx";
import { addDays, daysBetween } from "../dates";

/**
 * Fictional demo data shared by scripts/generate-sample-export.ts (the sample
 * Tally-style export in public/samples) and the demo seed. All names are invented.
 */

export const SAMPLE_VENDOR_NAMES = [
  "Sunrise Pharma Distributors",
  "Ganga Medical Agencies",
  "Shree Balaji Surgicals",
  "Apex Lifecare Traders",
  "Nilgiri Healthcare",
  "Moonlight Medicos",
  "Prakash Drug House",
  "Vardhman Pharma",
  "Kaveri Diagnostics Supply",
  "Lotus Wellness Distributors",
  "Himalaya Surgical Co",
  "Om Sai Medical Stores",
  "Green Leaf Ayurveda Supply",
  "Mehta Pharma Agencies",
  "Riverbend Labs Supply",
  "Coastal Medisales",
  "Sapphire Generics",
  "Unity Health Traders",
  "Deccan Bandage Works",
  "Silverline Pharma",
  "Pinnacle Ortho Supplies",
  "Royal Chemists Wholesale",
  "Tulsi Herbal Traders",
  "Evergreen Diagnostics",
] as const;

export interface SampleBill {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO
  dueDate: string; // ISO
  amountPaise: number;
}

/** Deterministic PRNG (mulberry32) so the sample file never changes between runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 48 outstanding bills across the 24 vendors, invoice numbers "DEMO/INV/1001"…,
 * invoice dates in the 60 days before `asOf`, credit 15/30/45 days.
 */
export function buildSampleBills(asOf = "2026-11-20"): SampleBill[] {
  const rand = rng(20261120);
  const credit = [15, 30, 45];
  const bills: SampleBill[] = [];
  let inv = 1001;
  SAMPLE_VENDOR_NAMES.forEach((vendorName, i) => {
    const count = i % 3 === 0 ? 3 : i % 3 === 1 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const invoiceDate = addDays(asOf, -Math.floor(5 + rand() * 55));
      const rupees = Math.round((2_000 + rand() * 1_20_000) / 10) * 10;
      const paise = rand() < 0.3 ? Math.floor(rand() * 100) : 0;
      bills.push({
        vendorName,
        invoiceNumber: `DEMO/INV/${inv++}`,
        invoiceDate,
        dueDate: addDays(invoiceDate, credit[i % credit.length]),
        amountPaise: rupees * 100 + paise,
      });
    }
  });
  return bills.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
}

function excelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25569;
}

/**
 * Tally "Bills Payable"-style workbook: company/report/period title rows, a blank
 * row, then Date | Ref. No. | Party's Name | Pending Amount | Due on | Overdue by days,
 * and a Grand Total row. Dates are real Excel date cells; amounts numeric.
 */
export function buildSampleExportWorkbook(asOf = "2026-11-20"): XLSX.WorkBook {
  const bills = buildSampleBills(asOf);
  const header = ["Date", "Ref. No.", "Party's Name", "Pending Amount", "Due on", "Overdue by days"];
  const aoa: unknown[][] = [
    ["Demo Medical Store (Sample Data)"],
    ["Bills Payable"],
    [`${bills[0].invoiceDate} to ${asOf}`],
    [],
    header,
  ];
  for (const b of bills) {
    const overdue = Math.max(0, daysBetween(b.dueDate, asOf));
    aoa.push([excelSerial(b.invoiceDate), b.invoiceNumber, b.vendorName, b.amountPaise / 100, excelSerial(b.dueDate), overdue || null]);
  }
  const total = bills.reduce((s, b) => s + b.amountPaise, 0);
  aoa.push([null, null, "Grand Total", total / 100, null, null]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const first = 5; // 0-based first data row
  for (let r = first; r < first + bills.length + 1; r++) {
    for (const c of [0, 4]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = "d-mmm-yy";
    }
    const amt = ws[XLSX.utils.encode_cell({ r, c: 3 })];
    if (amt) amt.z = "#,##0.00";
  }
  ws["!cols"] = [{ wch: 11 }, { wch: 16 }, { wch: 32 }, { wch: 16 }, { wch: 11 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bills Payable");
  return wb;
}
