/**
 * Tesseract.js fallback, used only when PaddleOCR cannot load. Runs from the
 * page (tesseract.js spawns its own worker). Fully self-hosted under
 * /tesseract/ — no jsDelivr: worker script, LSTM-only cores, gzipped
 * best_int traineddata (eng, + hin for Hindi).
 */
import type { OcrLang } from "../extract/types";
import { TESSERACT_BASE, TESSERACT_LANG_BASE } from "./assets";
import { toOcrResult, type OcrItem, type OcrResult } from "./reading-order";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
const workers = new Map<OcrLang, Promise<TWorker>>();

function abs(p: string): string {
  return new URL(p, window.location.origin).href;
}

async function getWorker(lang: OcrLang): Promise<TWorker> {
  let w = workers.get(lang);
  if (!w) {
    w = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      return createWorker(lang === "hi" ? ["eng", "hin"] : ["eng"], OEM.LSTM_ONLY, {
        workerPath: abs(`${TESSERACT_BASE}/worker.min.js`),
        corePath: abs(TESSERACT_BASE),
        langPath: abs(TESSERACT_LANG_BASE),
        gzip: true,
        workerBlobURL: false,
        // The service worker caches /tesseract/*; avoid a second IndexedDB copy.
        cacheMethod: "none",
      });
    })();
    w.catch(() => workers.delete(lang));
    workers.set(lang, w);
  }
  return w;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export async function tesseractOcr(image: Blob, lang: OcrLang): Promise<OcrResult> {
  const t0 = performance.now();
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
  const items: OcrItem[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        for (const w of l.words as TessWord[]) {
          items.push({
            text: w.text,
            confidence: w.confidence / 100,
            box: { x: w.bbox.x0, y: w.bbox.y0, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0 },
          });
        }
      }
    }
  }
  return toOcrResult(items, "tesseract", performance.now() - t0);
}

export async function terminateTesseract(): Promise<void> {
  const all = [...workers.values()];
  workers.clear();
  await Promise.all(all.map((p) => p.then((w) => w.terminate()).catch(() => undefined)));
}
