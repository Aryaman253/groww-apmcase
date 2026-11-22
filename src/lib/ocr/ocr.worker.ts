/// <reference lib="webworker" />
/**
 * OCR Web Worker: PaddleOCR PP-OCRv5 (ppu-paddle-ocr/web) on onnxruntime-web,
 * WebGPU when available, else WASM. Models are lazy-loaded on first use from
 * /models/paddle/ (Hugging Face only if a local file 404s); ORT wasm from /ort/.
 *
 * "en": detector + Latin recognizer. "hi": additionally the Devanagari
 * recognizer; per text box the Devanagari reading is used when it contains
 * Devanagari, else the Latin one (better for digits / IFSC / UPI).
 *
 * If Paddle cannot load, replies { code: "paddle-unavailable" } and the page
 * falls back to Tesseract.js (see index.ts).
 */
import * as ort from "onnxruntime-web";
import { PaddleOcrService, type RecognitionOptions } from "ppu-paddle-ocr/web";
import { ORT_WASM_BASE, PADDLE_ASSETS, PADDLE_DETECTION, PADDLE_RECOGNITION, PADDLE_HF_BASE, PADDLE_LOCAL_BASE, type PaddleAsset } from "./assets";
import { preprocessImage } from "./preprocess";
import { mergeDualScript, toOcrResult, type OcrItem } from "./reading-order";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// Must be set before any session is created (ppu-paddle-ocr defaults to jsDelivr).
ort.env.wasm.wasmPaths = new URL(ORT_WASM_BASE, self.location.origin).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const buffers = new Map<string, Promise<ArrayBuffer>>();

/** Same-origin first (cacheable by the service worker), Hugging Face if missing. */
function loadAsset(a: PaddleAsset): Promise<ArrayBuffer> {
  let p = buffers.get(a.file);
  if (!p) {
    p = (async () => {
      const local = await fetch(`${PADDLE_LOCAL_BASE}/${a.file}`).catch(() => null);
      if (local?.ok) return local.arrayBuffer();
      const remote = await fetch(`${PADDLE_HF_BASE}/${a.remote}`, { referrerPolicy: "no-referrer" });
      if (!remote.ok) throw new Error(`model ${a.file}: HTTP ${remote.status}`);
      return remote.arrayBuffer();
    })();
    p.catch(() => buffers.delete(a.file));
    buffers.set(a.file, p);
  }
  // Each session takes ownership of its buffer; hand out copies.
  return p.then((b) => b.slice(0));
}

let en: Promise<PaddleOcrService> | null = null;
let hi: Promise<PaddleOcrService> | null = null;
let backend = "wasm";

function createService(rec: PaddleAsset, dict: PaddleAsset): Promise<PaddleOcrService> {
  return (async () => {
    const [detection, recognition, charactersDictionary] = await Promise.all([
      loadAsset(PADDLE_ASSETS.det),
      loadAsset(rec),
      loadAsset(dict),
    ]);
    const svc = new PaddleOcrService({
      model: { detection, recognition, charactersDictionary },
      detection: { ...PADDLE_DETECTION },
      // charactersDictionary comes from `model`; the type marks it required.
      recognition: { ...PADDLE_RECOGNITION, mainThreadYieldMs: 0 } as RecognitionOptions,
    });
    await svc.initialize();
    const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    backend = gpu ? "webgpu|wasm" : "wasm";
    return svc;
  })();
}

function service(lang: "en" | "hi"): Promise<PaddleOcrService> {
  if (lang === "en") {
    en ??= createService(PADDLE_ASSETS.enRec, PADDLE_ASSETS.enDict);
    en.catch(() => (en = null));
    return en;
  }
  hi ??= createService(PADDLE_ASSETS.hiRec, PADDLE_ASSETS.hiDict);
  hi.catch(() => (hi = null));
  return hi;
}

interface FlatResult {
  results: OcrItem[];
}

async function recognize(svc: PaddleOcrService, canvas: OffscreenCanvas | HTMLCanvasElement): Promise<OcrItem[]> {
  const r = (await svc.recognize(canvas as OffscreenCanvas, { flatten: true, noCache: true })) as unknown as FlatResult;
  return r.results.map((x) => ({ text: x.text, confidence: x.confidence, box: x.box }));
}

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  const t0 = performance.now();
  let svcs: PaddleOcrService[];
  try {
    if (!en || (msg.lang === "hi" && !hi)) post({ id: msg.id, type: "progress", stage: "loading" });
    svcs = await Promise.all(msg.lang === "hi" ? [service("en"), service("hi")] : [service("en")]);
  } catch (e) {
    post({ id: msg.id, type: "error", code: "paddle-unavailable", message: String(e) });
    return;
  }
  if (msg.type === "warmup") {
    post({ id: msg.id, type: "done", result: { text: "", lines: [], engine: "paddle", avgConfidence: 0, ms: 0 }, backend });
    return;
  }
  try {
    post({ id: msg.id, type: "progress", stage: "reading" });
    const pre = await preprocessImage(msg.image, { crop: msg.crop, enhance: msg.enhance });
    const latin = await recognize(svcs[0], pre.canvas);
    const items = svcs[1] ? mergeDualScript(latin, await recognize(svcs[1], pre.canvas)) : latin;
    post({ id: msg.id, type: "done", result: toOcrResult(items, "paddle", performance.now() - t0), backend });
  } catch (e) {
    post({ id: msg.id, type: "error", code: "ocr-failed", message: String(e) });
  }
};
