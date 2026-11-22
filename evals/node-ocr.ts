/**
 * Node adapters so the evals run the same OCR stack as the browser:
 *  - preprocessing: sharp for decode/EXIF/resize + the shared enhanceRgba()
 *  - PaddleOCR: ppu-paddle-ocr Node entry (onnxruntime-node), same PP-OCRv5
 *    model files as /public/models/paddle, canvas-native engine like the web build
 *  - Tesseract.js (Node) with the same LSTM-only traineddata as /public/tesseract
 *  - PDF text layer: pdfjs-dist legacy build + the shared pdfItemsToText()
 */
import path from "node:path";
import sharp from "sharp";
import { PaddleOcrService, type RecognitionOptions } from "ppu-paddle-ocr";
import { createWorker, OEM, type Worker as TesseractWorker } from "tesseract.js";
import { PADDLE_ASSETS, PADDLE_DETECTION, PADDLE_RECOGNITION } from "../src/lib/ocr/assets";
import { enhanceRgba, targetSize } from "../src/lib/ocr/enhance";
import { mergeDualScript, toOcrResult, type OcrItem, type OcrResult } from "../src/lib/ocr/reading-order";
import { pdfItemsToText, type PdfTextItem } from "../src/lib/ocr/pdf-text";

const ROOT = path.resolve(__dirname, "..");
const MODELS = path.join(ROOT, "public", "models", "paddle");
const TESS_LANG = path.join(ROOT, "public", "tesseract", "lang");

export async function preprocessNode(input: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const img = sharp(input).rotate(); // EXIF orientation
  const meta = await img.metadata();
  const { width, height } = targetSize(meta.width ?? 1000, meta.height ?? 1000);
  const { data, info } = await img
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  enhanceRgba(data);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { png, width: info.width, height: info.height };
}

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

let paddleEn: PaddleOcrService | null = null;
let paddleHi: PaddleOcrService | null = null;

async function paddle(lang: "en" | "hi"): Promise<PaddleOcrService> {
  const make = async (rec: string, dict: string) => {
    const s = new PaddleOcrService({
      model: {
        detection: path.join(MODELS, PADDLE_ASSETS.det.file),
        recognition: path.join(MODELS, rec),
        charactersDictionary: path.join(MODELS, dict),
      },
      processing: { engine: "canvas-native" },
      detection: PADDLE_DETECTION,
      recognition: { ...PADDLE_RECOGNITION } as RecognitionOptions,
    });
    await s.initialize();
    return s;
  };
  if (lang === "en") return (paddleEn ??= await make(PADDLE_ASSETS.enRec.file, PADDLE_ASSETS.enDict.file));
  return (paddleHi ??= await make(PADDLE_ASSETS.hiRec.file, PADDLE_ASSETS.hiDict.file));
}

interface FlatResult {
  results: { text: string; confidence: number; box: { x: number; y: number; width: number; height: number } }[];
}

async function paddleItems(svc: PaddleOcrService, png: Buffer): Promise<OcrItem[]> {
  const r = (await svc.recognize(toArrayBuffer(png), { flatten: true, noCache: true })) as unknown as FlatResult;
  return r.results.map((x) => ({ text: x.text, confidence: x.confidence, box: x.box }));
}

export async function warmPaddle(lang: "en" | "hi"): Promise<number> {
  const t0 = performance.now();
  await paddle("en");
  if (lang === "hi") await paddle("hi");
  return performance.now() - t0;
}

export async function ocrPaddleNode(png: Buffer, lang: "en" | "hi"): Promise<OcrResult> {
  const t0 = performance.now();
  const en = await paddleItems(await paddle("en"), png);
  const items = lang === "hi" ? mergeDualScript(en, await paddleItems(await paddle("hi"), png)) : en;
  return toOcrResult(items, "paddle", performance.now() - t0);
}

const tess = new Map<string, TesseractWorker>();

async function tesseract(lang: "en" | "hi"): Promise<TesseractWorker> {
  const key = lang;
  let w = tess.get(key);
  if (!w) {
    w = await createWorker(lang === "hi" ? ["eng", "hin"] : ["eng"], OEM.LSTM_ONLY, {
      langPath: TESS_LANG,
      gzip: true,
      cacheMethod: "none",
    });
    tess.set(key, w);
  }
  return w;
}

export async function warmTesseract(lang: "en" | "hi"): Promise<number> {
  const t0 = performance.now();
  await tesseract(lang);
  return performance.now() - t0;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export async function ocrTesseractNode(png: Buffer, lang: "en" | "hi"): Promise<OcrResult> {
  const t0 = performance.now();
  const w = await tesseract(lang);
  const { data } = await w.recognize(png, {}, { blocks: true, text: true });
  const words: TessWord[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) words.push(...(l.words as TessWord[]));
  const items: OcrItem[] = words.map((x) => ({
    text: x.text,
    confidence: x.confidence / 100,
    box: { x: x.bbox.x0, y: x.bbox.y0, width: x.bbox.x1 - x.bbox.x0, height: x.bbox.y1 - x.bbox.y0 },
  }));
  return toOcrResult(items, "tesseract", performance.now() - t0);
}

export async function pdfTextNode(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(pdfItemsToText(content.items.filter((it): it is PdfTextItem & typeof it => "str" in it) as PdfTextItem[]));
  }
  await task.destroy();
  return pages.join("\n");
}

export async function shutdownOcr(): Promise<void> {
  await Promise.all([...tess.values()].map((w) => w.terminate()));
  await paddleEn?.destroy();
  await paddleHi?.destroy();
}

/** Renders PDF pages 1–2 to PNG (pdf.js uses @napi-rs/canvas in Node), mirroring the browser fallback. */
export async function renderPdfPagesNode(buf: Buffer, maxPages = 2): Promise<Buffer[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 });
  const doc = await task.promise;
  const out: Buffer[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 2000 / Math.max(base.width, base.height) });
      const factory = doc.canvasFactory as { create(w: number, h: number): { canvas: { toBuffer(t: string): Buffer } } };
      const { canvas } = factory.create(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      out.push(canvas.toBuffer("image/png"));
    }
  } finally {
    await task.destroy();
  }
  return out;
}
