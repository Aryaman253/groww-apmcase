/**
 * On-device auto-fill — browser client API. Import only from client code
 * (e.g. `await import("@/lib/ocr")` inside a "use client" component).
 * Nothing leaves the device: no AI or OCR services are called.
 *
 * Same-origin assets (populated by `npm run models:fetch`; fetched with plain
 * GETs so a cache-first service worker can keep them offline):
 *   /models/paddle/*   PaddleOCR PP-OCRv5 det + en rec/dict (+ devanagari rec/dict on demand), ~20 MB
 *   /ort/*             onnxruntime-web JSEP wasm (WebGPU + WASM), ~28 MB (≈7 MB gzip/br)
 *   /tesseract/*       Tesseract.js fallback: worker, LSTM cores, lang/{eng,hin}.traineddata.gz, ~15 MB
 * Hugging Face (huggingface.co → *.hf.co CDN) is contacted only if a Paddle
 * model is missing locally. The pdf.js worker is bundled (pdf.worker.ts).
 *
 * Pipelines:
 *   image → [worker] EXIF/resize/crop → PaddleOCR (WebGPU|WASM) → reading order → parser
 *          (Tesseract.js on the page only if Paddle fails to load)
 *   pdf   → pdf.js text layer → parser; no/garbled text layer → render p.1–2 → OCR → parser
 *   text  → parser
 */
import { PARSER_VERSION, parseInvoiceText, parseVendorText } from "../extract/parser";
import { looksGarbledDevanagari } from "../extract/normalize";
import type {
  CropRect,
  ExtractCallOptions,
  ExtractInput,
  ExtractionMeta,
  ExtractionResult,
  ExtractionStage,
  Extractor,
  InvoiceExtraction,
  OcrLang,
  ParseOptions,
  SourceType,
  TextEngine,
  VendorExtraction,
} from "../extract/types";
import { hasUsableText, pdfItemsToText, type PdfTextItem } from "./pdf-text";
import { canvasToBlob } from "./preprocess";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { OcrResult } from "./reading-order";

export { PARSER_VERSION };
export type { OcrResult, OcrLine } from "./reading-order";
export type * from "../extract/types";

export interface OcrOptions {
  lang?: OcrLang;
  crop?: CropRect;
  onProgress?: (stage: ExtractionStage) => void;
}

export interface ImageExtractOptions extends OcrOptions {
  ownGstin?: string | null;
}

export interface PdfExtractOptions {
  lang?: OcrLang;
  ownGstin?: string | null;
  onProgress?: (stage: ExtractionStage) => void;
}

export interface OcrRun extends OcrResult {
  warnings: string[];
}

// ───────────────────────────── OCR worker ─────────────────────────────

const LOAD_TIMEOUT_MS = 150_000;
const RUN_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let paddleBroken: string | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: WorkerResponse) => void; onProgress?: (s: "loading" | "reading") => void; timer: ReturnType<typeof setTimeout>; loading: boolean }
>();

function failAll(reason: string) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ id, type: "error", code: "paddle-unavailable", message: reason });
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./ocr.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.(msg.stage);
      if (msg.stage === "reading" && p.loading) {
        // Models are loaded: switch to the shorter run timeout.
        p.loading = false;
        clearTimeout(p.timer);
        p.timer = setTimeout(() => timeout(msg.id), RUN_TIMEOUT_MS);
      }
      return;
    }
    clearTimeout(p.timer);
    pending.delete(msg.id);
    p.resolve(msg);
  };
  w.onerror = (e) => {
    paddleBroken = `worker error: ${e.message || "failed to start"}`;
    failAll(paddleBroken);
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

function timeout(id: number) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  // A stuck worker is unusable: restart it next time.
  worker?.terminate();
  worker = null;
  failAll("timeout");
  p.resolve({ id, type: "error", code: p.loading ? "paddle-unavailable" : "ocr-failed", message: "timeout" });
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

function ask(req: WithoutId<WorkerRequest>, onProgress?: (s: "loading" | "reading") => void): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = getWorker();
    } catch (e) {
      resolve({ id: 0, type: "error", code: "paddle-unavailable", message: String(e) });
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => timeout(id), LOAD_TIMEOUT_MS);
    pending.set(id, { resolve, onProgress, timer, loading: true });
    w.postMessage({ ...req, id } as WorkerRequest);
  });
}

/** Preloads OCR models (e.g. when the user opens the scan sheet). Never throws. */
export async function warmUpOcr(lang: OcrLang = "en"): Promise<boolean> {
  if (paddleBroken) return false;
  const r = await ask({ type: "warmup", lang });
  if (r.type === "error") paddleBroken = r.message;
  return r.type === "done";
}

/**
 * OCR one image: PaddleOCR in a worker; Tesseract.js only if Paddle cannot
 * load. Throws if both engines fail.
 */
export async function runOcr(file: Blob, opts: OcrOptions = {}): Promise<OcrRun> {
  const lang = opts.lang ?? "en";
  const warnings: string[] = [];
  if (!paddleBroken) {
    const r = await ask({ type: "ocr", image: file, lang, crop: opts.crop }, (s) => opts.onProgress?.(s));
    if (r.type === "done") return { ...r.result, warnings };
    if (r.type === "error" && r.code === "paddle-unavailable") paddleBroken = r.message;
    warnings.push(`paddle-${r.type === "error" ? r.code : "failed"}: ${r.type === "error" ? r.message : ""}`.trim());
  } else {
    warnings.push(`paddle-unavailable: ${paddleBroken}`);
  }
  // Fallback: Tesseract.js on the page.
  try {
    opts.onProgress?.("loading");
    const { preprocessImage } = await import("./preprocess");
    const { tesseractOcr } = await import("./tesseract");
    const pre = await preprocessImage(file, { crop: opts.crop });
    opts.onProgress?.("reading");
    const res = await tesseractOcr(await canvasToBlob(pre.canvas), lang);
    warnings.push("fell back to tesseract");
    return { ...res, warnings };
  } catch (e) {
    throw new Error(`On-device OCR failed (PaddleOCR: ${warnings.join("; ")}; Tesseract: ${String(e)})`);
  }
}

// ───────────────────────────── PDF ─────────────────────────────

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    if (!m.GlobalWorkerOptions.workerPort) {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    }
    return m;
  });
  pdfjsPromise.catch(() => (pdfjsPromise = null));
  return pdfjsPromise;
}

export interface PdfText {
  text: string;
  engine: TextEngine;
  ocr?: OcrResult;
  warnings: string[];
}

/**
 * Text from a PDF: the pdf.js text layer (first 3 pages); if there is none, or
 * it is garbled Devanagari, pages 1–2 are rendered and OCR'd.
 */
export async function extractTextFromPdf(file: Blob, opts: { lang?: OcrLang; onProgress?: (s: ExtractionStage) => void } = {}): Promise<PdfText> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const warnings: string[] = [];
  try {
    opts.onProgress?.("reading");
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pdfItemsToText(content.items.filter((it) => "str" in it) as PdfTextItem[]));
    }
    const text = pages.join("\n");
    const garbled = text.split("\n").filter(looksGarbledDevanagari).length >= 2;
    if (hasUsableText(text) && !garbled) return { text, engine: "pdf-text", warnings };
    warnings.push(garbled ? "pdf-text-garbled: used OCR" : "pdf-no-text-layer: used OCR");

    const texts: string[] = [];
    const lines: OcrResult["lines"] = [];
    let engine: TextEngine = "paddle";
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = 2000 / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const r = await runOcr(await canvasToBlob(canvas), { lang: opts.lang ?? (garbled ? "hi" : "en"), onProgress: opts.onProgress });
      texts.push(r.text);
      lines.push(...r.lines);
      engine = r.engine;
      warnings.push(...r.warnings);
    }
    const ocr: OcrResult = {
      text: texts.join("\n"),
      lines,
      engine: engine === "tesseract" ? "tesseract" : "paddle",
      avgConfidence: lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0,
    };
    if (!hasUsableText(ocr.text) && hasUsableText(text)) {
      warnings.push("ocr-empty: kept text layer");
      return { text, engine: "pdf-text", warnings };
    }
    return { text: ocr.text, engine, ocr, warnings };
  } finally {
    await task.destroy();
  }
}

// ───────────────────────────── extraction ─────────────────────────────

function ocrOpts(ocr?: OcrResult): ParseOptions {
  return ocr ? { ocrLineConfidences: ocr.lines.map((l) => l.confidence), ocrWordConfidence: ocr.avgConfidence } : {};
}

function meta(sourceType: SourceType, t0: number, text: string, extra: Partial<ExtractionMeta> = {}): ExtractionMeta {
  const m: ExtractionMeta = {
    parserVersion: PARSER_VERSION,
    sourceType,
    ms: Math.round(performance.now() - t0),
    textLength: text.length,
    ...extra,
  };
  if (!m.warnings?.length) delete m.warnings;
  return m;
}

export async function extractVendorFromText(text: string): Promise<ExtractionResult<VendorExtraction>> {
  const t0 = performance.now();
  return { fields: parseVendorText(text), meta: meta("paste", t0, text), text };
}

export async function extractInvoiceFromText(text: string, opts: { ownGstin?: string | null } = {}): Promise<ExtractionResult<InvoiceExtraction>> {
  const t0 = performance.now();
  return { fields: parseInvoiceText(text, { ownGstin: opts.ownGstin }), meta: meta("paste", t0, text), text };
}

export async function extractVendorFromImage(file: Blob, opts: OcrOptions = {}): Promise<ExtractionResult<VendorExtraction>> {
  const t0 = performance.now();
  const ocr = await runOcr(file, opts);
  opts.onProgress?.("parsing");
  return {
    fields: parseVendorText(ocr.text, ocrOpts(ocr)),
    meta: meta("image", t0, ocr.text, { engine: ocr.engine, ocrConfidence: round3(ocr.avgConfidence), warnings: ocr.warnings }),
    text: ocr.text,
  };
}

export async function extractInvoiceFromImage(file: Blob, opts: ImageExtractOptions = {}): Promise<ExtractionResult<InvoiceExtraction>> {
  const t0 = performance.now();
  const ocr = await runOcr(file, opts);
  opts.onProgress?.("parsing");
  return {
    fields: parseInvoiceText(ocr.text, { ...ocrOpts(ocr), ownGstin: opts.ownGstin }),
    meta: meta("image", t0, ocr.text, { engine: ocr.engine, ocrConfidence: round3(ocr.avgConfidence), warnings: ocr.warnings }),
    text: ocr.text,
  };
}

export async function extractInvoiceFromPdf(file: Blob, opts: PdfExtractOptions = {}): Promise<ExtractionResult<InvoiceExtraction>> {
  const t0 = performance.now();
  opts.onProgress?.("loading");
  const pdf = await extractTextFromPdf(file, opts);
  opts.onProgress?.("parsing");
  return {
    fields: parseInvoiceText(pdf.text, { ...ocrOpts(pdf.ocr), ownGstin: opts.ownGstin }),
    meta: meta("pdf", t0, pdf.text, { engine: pdf.engine, ocrConfidence: pdf.ocr ? round3(pdf.ocr.avgConfidence) : undefined, warnings: pdf.warnings }),
    text: pdf.text,
  };
}

export async function extractVendorFromPdf(file: Blob, opts: Omit<PdfExtractOptions, "ownGstin"> = {}): Promise<ExtractionResult<VendorExtraction>> {
  const t0 = performance.now();
  opts.onProgress?.("loading");
  const pdf = await extractTextFromPdf(file, opts);
  opts.onProgress?.("parsing");
  return {
    fields: parseVendorText(pdf.text, ocrOpts(pdf.ocr)),
    meta: meta("pdf", t0, pdf.text, { engine: pdf.engine, ocrConfidence: pdf.ocr ? round3(pdf.ocr.avgConfidence) : undefined, warnings: pdf.warnings }),
    text: pdf.text,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** The on-device implementation of the Extractor interface. */
export class OnDeviceExtractor implements Extractor {
  readonly id = "on-device";

  extractVendor(input: ExtractInput, opts: ExtractCallOptions = {}): Promise<ExtractionResult<VendorExtraction>> {
    if (input.kind === "text") return extractVendorFromText(input.text);
    if (input.kind === "image") return extractVendorFromImage(input.file, { lang: input.lang, crop: input.crop, onProgress: opts.onProgress });
    return extractVendorFromPdf(input.file, { lang: input.lang, onProgress: opts.onProgress });
  }

  extractInvoice(input: ExtractInput, opts: ExtractCallOptions & { ownGstin?: string | null } = {}): Promise<ExtractionResult<InvoiceExtraction>> {
    if (input.kind === "text") return extractInvoiceFromText(input.text, opts);
    if (input.kind === "image") {
      return extractInvoiceFromImage(input.file, { lang: input.lang, crop: input.crop, onProgress: opts.onProgress, ownGstin: opts.ownGstin });
    }
    return extractInvoiceFromPdf(input.file, { lang: input.lang, onProgress: opts.onProgress, ownGstin: opts.ownGstin });
  }
}

/** Releases workers and model memory (e.g. when leaving the scan flow). */
export async function disposeOcr(): Promise<void> {
  worker?.terminate();
  worker = null;
  failAll("disposed");
  const { terminateTesseract } = await import("./tesseract");
  await terminateTesseract();
}
