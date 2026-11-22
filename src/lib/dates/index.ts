/**
 * Dates are stored as ISO "YYYY-MM-DD" strings (Postgres `date`).
 * Display as DD/MM/YYYY. Arithmetic is done in UTC to avoid TZ drift.
 */

export type IsoDate = string; // YYYY-MM-DD

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIso(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parses common Indian formats: 05/03/2025, 5-3-25, 05.03.2025, 2025-03-05,
 * 5 Mar 2025, 05-Mar-25, March 5, 2025. Day-first for numeric forms.
 * Also accepts Excel serial numbers (number) and Date objects.
 */
export function parseIndianDate(input: unknown): IsoDate | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return toIso(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  if (typeof input === "number") {
    if (input > 20000 && input < 80000) {
      // Excel serial date (1900 system)
      const ms = Math.round((input - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(input).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})$/);
  if (m) return toIso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/.\s]*([a-z]{3,9})[-/.,\s]*(\d{2,4})$/);
  if (m && MONTHS[m[2]]) return toIso(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/^([a-z]{3,9})[-/.\s]*(\d{1,2}),?[-/.\s]*(\d{2,4})$/);
  if (m && MONTHS[m[1]]) return toIso(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

export function formatDate(iso: IsoDate | null | undefined, locale: string = "en"): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (locale === "hi") return `${d}/${m}/${y}`;
  return `${d}/${m}/${y}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** Today in India (IST), as ISO date. */
export function todayIst(now: Date = new Date()): IsoDate {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/** Due date: printed due date wins; otherwise invoice date + credit days. */
export function computeDueDate(opts: {
  printedDueDate?: IsoDate | null;
  invoiceDate?: IsoDate | null;
  creditDays?: number | null;
}): IsoDate | null {
  if (opts.printedDueDate) return opts.printedDueDate;
  if (!opts.invoiceDate) return null;
  return addDays(opts.invoiceDate, Math.max(0, opts.creditDays ?? 0));
}
