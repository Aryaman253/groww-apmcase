import * as XLSX from "xlsx";

export interface SheetData {
  name: string;
  /** 1-based sheet row number of the detected header row (0 when the sheet is empty). */
  headerRowNumber: number;
  headers: string[];
  /** One record per non-empty data row, keyed by header. Values are raw: string | number | boolean | null. */
  rows: Record<string, unknown>[];
  /** 1-based sheet row number of each entry in `rows` (for error messages). */
  rowNumbers: number[];
}

export interface SpreadsheetData {
  sheets: SheetData[];
}

const BINARY_EXT = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;

function isBinary(bytes: Uint8Array, filename: string): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return true; // PK zip (xlsx/ods)
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return true; // xls
  return BINARY_EXT.test(filename) && !/^[\x09\x0a\x0d\x20-\x7e]/.test(String.fromCharCode(bytes[0] ?? 0));
}

function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Older Tally/Marg exports are often Windows-1252.
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** A "text" cell for header detection: non-empty and not just a number/amount/date. */
function isTextCell(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.length > 0 && !/^[-+()\d.,₹/\s:]+$/.test(s);
}

/**
 * Header row = first row within the first 10 with ≥3 non-empty text cells
 * (Tally exports start with company/report/period title rows). Falls back to
 * the first non-empty row. Returns an index into `aoa`.
 */
function detectHeaderRow(aoa: unknown[][]): number {
  const limit = Math.min(aoa.length, 10);
  for (let i = 0; i < limit; i++) {
    if ((aoa[i] ?? []).filter(isTextCell).length >= 3) return i;
  }
  const first = aoa.findIndex((r) => (r ?? []).some((c) => !isEmpty(c)));
  return first < 0 ? -1 : first;
}

function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = isEmpty(h) ? `Column ${i + 1}` : String(h).replace(/\s+/g, " ").trim();
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

function cellValue(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" ? null : s;
  }
  return v ?? null;
}

/**
 * Reads an Excel (xlsx/xls/ods) or CSV/TXT export into sheets of records.
 * CSV values are kept as text (no locale guessing: "05/03/2026" stays a string for
 * day-first parsing). Excel dates come through as serial numbers, which
 * parseIndianDate() understands.
 * `headerRowHint` (1-based sheet row) overrides header detection, e.g. from a saved preset.
 */
export function readSpreadsheet(
  data: ArrayBuffer | Uint8Array,
  filename: string,
  opts: { headerRowHint?: number } = {},
): SpreadsheetData {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = isBinary(bytes, filename)
    ? XLSX.read(bytes, { type: "array", cellDates: false, cellHTML: false, cellFormula: false })
    : XLSX.read(decodeText(bytes), { type: "string", raw: true, cellDates: false });

  const sheets: SheetData[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) return { name, headerRowNumber: 0, headers: [], rows: [], rowNumbers: [] };
    const startRow = XLSX.utils.decode_range(ws["!ref"]).s.r; // 0-based
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });

    let h = opts.headerRowHint ? opts.headerRowHint - 1 - startRow : detectHeaderRow(aoa);
    if (h < 0 || h >= aoa.length) h = detectHeaderRow(aoa);
    if (h < 0) return { name, headerRowNumber: 0, headers: [], rows: [], rowNumbers: [] };

    const headerCells = [...(aoa[h] ?? [])];
    while (headerCells.length && isEmpty(headerCells[headerCells.length - 1])) headerCells.pop();
    const headers = uniqueHeaders(headerCells);

    const rows: Record<string, unknown>[] = [];
    const rowNumbers: number[] = [];
    for (let i = h + 1; i < aoa.length; i++) {
      const r = aoa[i] ?? [];
      if (!r.slice(0, headers.length).some((c) => !isEmpty(c))) continue;
      const rec: Record<string, unknown> = {};
      headers.forEach((hd, j) => (rec[hd] = cellValue(r[j])));
      rows.push(rec);
      rowNumbers.push(startRow + i + 1);
    }
    return { name, headerRowNumber: startRow + h + 1, headers, rows, rowNumbers };
  });
  return { sheets };
}
