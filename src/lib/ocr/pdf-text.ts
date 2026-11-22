/**
 * Assembles pdf.js text-layer items into reading-order lines. Pure: used by
 * the browser (pdfjs-dist) and the Node evals (pdfjs-dist legacy build).
 */

export interface PdfTextItem {
  str: string;
  /** pdf.js transform matrix [a, b, c, d, e, f]; e/f are x/y (PDF origin bottom-left). */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export function pdfItemsToText(items: PdfTextItem[]): string {
  const parts = items
    .filter((i) => i.str.trim())
    .map((i) => ({
      str: i.str,
      x: i.transform[4],
      y: i.transform[5],
      w: i.width,
      h: Math.abs(i.height) || Math.abs(i.transform[3]) || 10,
    }));
  // Top of page first (PDF y grows upwards).
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: (typeof parts)[] = [];
  for (const p of parts) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - p.y) <= Math.max(2, Math.min(row[0].h, p.h) * 0.5)) row.push(p);
    else rows.push([p]);
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let line = "";
      row.forEach((p, k) => {
        if (k > 0) {
          const prev = row[k - 1];
          const gap = p.x - (prev.x + prev.w);
          const charW = prev.w / Math.max(1, prev.str.length);
          if (gap > charW * 2.5) line += "  ";
          else if (gap > charW * 0.15 && !line.endsWith(" ") && !p.str.startsWith(" ")) line += " ";
        }
        line += p.str;
      });
      return line.replace(/\s+$/u, "");
    })
    .join("\n");
}

/** Heuristic: does the PDF have a usable text layer? */
export function hasUsableText(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 20;
}
