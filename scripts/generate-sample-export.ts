/**
 * Writes public/samples/sample-bills-export.xlsx — a fictional Tally-style
 * "Bills Payable" export for the 24 demo vendors (see src/lib/import/sample-data.ts).
 *
 *   npx tsx scripts/generate-sample-export.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { buildSampleBills, buildSampleExportWorkbook } from "../src/lib/import/sample-data";

const out = path.join(process.cwd(), "public", "samples", "sample-bills-export.xlsx");
const wb = buildSampleExportWorkbook();
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, buf);
const bills = buildSampleBills();
console.log(`Wrote ${out} (${bills.length} bills, ${buf.length} bytes)`);
