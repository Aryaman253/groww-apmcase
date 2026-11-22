/**
 * Merge OCR boxes into lines in reading order: top-to-bottom, then
 * left-to-right, grouping boxes whose vertical extents overlap. Pure; shared by
 * the browser worker, the Tesseract fallback and the Node evals.
 */

export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrItem {
  text: string;
  /** 0..1 */
  confidence: number;
  box: OcrBox;
}

export interface OcrLine extends OcrItem {
  /** Items that make up this line, left to right. */
  items?: OcrItem[];
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  engine: "paddle" | "tesseract";
  /** Character-weighted mean confidence, 0..1. */
  avgConfidence: number;
  ms?: number;
}

/** Vertical overlap of two boxes relative to the smaller height (0..1). */
function vOverlap(a: OcrBox, b: OcrBox): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, bottom - top) / Math.max(1, Math.min(a.height, b.height));
}

export function mergeReadingOrder(items: OcrItem[], overlap = 0.5): OcrLine[] {
  const clean = items.filter((i) => i.text.trim());
  const medH = median(clean.map((i) => i.box.height));
  // Watermarks / stamps ("CANCELLED") span several rows: keep them on their own line.
  const isGiant = (i: OcrItem) => i.box.height > medH * 3;
  const sorted = [...clean].sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2));
  const rows: OcrItem[][] = [];
  for (const it of sorted) {
    let best: OcrItem[] | null = null;
    let bestScore = overlap;
    if (!isGiant(it)) {
      for (const row of rows.slice(-3)) {
        if (row.some(isGiant)) continue;
        const score = Math.max(...row.map((r) => vOverlap(r.box, it.box)));
        // Detector boxes are padded, so only a substantial horizontal overlap means "different row".
        const xClash = row.some((r) => hOverlap(r.box, it.box) > 0.5);
        if (score >= bestScore && !xClash) {
          best = row;
          bestScore = score;
        }
      }
    }
    if (best) best.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    const items_ = row.sort((a, b) => a.box.x - b.box.x);
    const charW = median(items_.map((i) => i.box.width / Math.max(1, i.text.length)));
    let text = "";
    items_.forEach((it, k) => {
      if (k > 0) {
        const prev = items_[k - 1];
        const gap = it.box.x - (prev.box.x + prev.box.width);
        // Wide gaps (table columns) become a double space: a soft field boundary for the parser.
        text += gap > charW * 2.5 ? "  " : " ";
      }
      text += it.text.trim();
    });
    const x = Math.min(...items_.map((i) => i.box.x));
    const y = Math.min(...items_.map((i) => i.box.y));
    const right = Math.max(...items_.map((i) => i.box.x + i.box.width));
    const bottom = Math.max(...items_.map((i) => i.box.y + i.box.height));
    return {
      text,
      confidence: weightedConfidence(items_),
      box: { x, y, width: right - x, height: bottom - y },
      items: items_,
    };
  });
}

/** Horizontal overlap relative to the narrower box (0..1). */
function hOverlap(a: OcrBox, b: OcrBox): number {
  const l = Math.max(a.x, b.x);
  const r = Math.min(a.x + a.width, b.x + b.width);
  return Math.max(0, r - l) / Math.max(1, Math.min(a.width, b.width));
}

export function weightedConfidence(items: OcrItem[]): number {
  let chars = 0;
  let sum = 0;
  for (const i of items) {
    const n = Math.max(1, i.text.trim().length);
    chars += n;
    sum += i.confidence * n;
  }
  return chars ? sum / chars : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 8;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Builds the final result from raw items (any engine). */
export function toOcrResult(items: OcrItem[], engine: OcrResult["engine"], ms?: number): OcrResult {
  const lines = mergeReadingOrder(items);
  return {
    text: lines.map((l) => l.text).join("\n"),
    lines,
    engine,
    avgConfidence: weightedConfidence(lines),
    ms,
  };
}

const DEVANAGARI = /[ऀ-ॿ]/;

function iou(a: OcrBox, b: OcrBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Hindi mode runs the Latin and the Devanagari recognizer over the same
 * detection boxes. Per box: take the Devanagari reading when it actually
 * contains Devanagari, else the Latin reading (better for digits/IFSC/UPI).
 */
export function mergeDualScript(latin: OcrItem[], devanagari: OcrItem[]): OcrItem[] {
  const used = new Set<number>();
  const out: OcrItem[] = latin.map((l) => {
    let bestIdx = -1;
    let best = 0.5;
    devanagari.forEach((d, i) => {
      const s = iou(l.box, d.box);
      if (s > best && !used.has(i)) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx < 0) return l;
    used.add(bestIdx);
    const d = devanagari[bestIdx];
    return DEVANAGARI.test(d.text) ? d : l;
  });
  devanagari.forEach((d, i) => {
    if (!used.has(i) && DEVANAGARI.test(d.text)) out.push(d);
  });
  return out;
}
