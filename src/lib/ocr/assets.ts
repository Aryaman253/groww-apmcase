/**
 * Same-origin locations of every OCR asset. Pure constants: imported by the
 * browser OCR code, by `scripts/fetch-models.ts` (which populates `public/`)
 * and by the Node evals (which read the same files from disk).
 *
 *   /models/paddle/*  PaddleOCR PP-OCRv5 detection/recognition models + dicts
 *   /ort/*            onnxruntime-web WASM binaries (ort.env.wasm.wasmPaths)
 *   /tesseract/*      Tesseract.js worker, core (LSTM-only) and lang/*.traineddata.gz
 *
 * A service worker may cache `/models/*`, `/ort/*` and `/tesseract/*`
 * cache-first; all of them are fetched with plain `fetch()` GETs.
 */

/** Hugging Face mirror used by ppu-paddle-ocr; fallback only when a local file 404s. */
export const PADDLE_HF_BASE = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main";

export const PADDLE_LOCAL_BASE = "/models/paddle";
export const ORT_WASM_BASE = "/ort/";
export const TESSERACT_BASE = "/tesseract";
export const TESSERACT_LANG_BASE = "/tesseract/lang";

export interface PaddleAsset {
  /** File name under /models/paddle/ */
  file: string;
  /** Path relative to PADDLE_HF_BASE (fallback). */
  remote: string;
}

/** PP-OCRv5 mobile: shared detector, English (Latin) recognizer, Devanagari recognizer. */
export const PADDLE_ASSETS = {
  det: {
    file: "PP-OCRv5_mobile_det_infer.ort",
    remote: "detection/PP-OCRv5_mobile_det_infer.ort",
  },
  enRec: {
    file: "en_PP-OCRv5_mobile_rec_infer.ort",
    remote: "recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.ort",
  },
  enDict: {
    file: "ppocrv5_en_dict.txt",
    remote: "recognition/multi/en/v5/ppocrv5_en_dict.txt",
  },
  hiRec: {
    file: "devanagari_PP-OCRv5_mobile_rec_infer.onnx",
    remote: "recognition/multi/devanagari/v5/devanagari_PP-OCRv5_mobile_rec_infer.onnx",
  },
  hiDict: {
    file: "ppocrv5_devanagari_dict.txt",
    remote: "recognition/multi/devanagari/v5/ppocrv5_devanagari_dict.txt",
  },
} as const satisfies Record<string, PaddleAsset>;

export type PaddleAssetKey = keyof typeof PADDLE_ASSETS;

/** onnxruntime-web's default bundle (WebGPU/JSEP build) loads only this pair. */
export const ORT_FILES = ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"] as const;

/**
 * Tesseract.js 7: worker script plus the LSTM-only cores (we always run
 * OEM.LSTM_ONLY with the `4.0.0_best_int` traineddata). getCore() picks one of
 * these by feature detection (relaxed-SIMD → SIMD → plain).
 */
export const TESSERACT_FILES = [
  "worker.min.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
] as const;

export const TESSERACT_LANGS = ["eng", "hin"] as const;

/**
 * Paddle tuning, chosen with evals/: per-box recognition (per-line merging
 * dropped whole lines on sparse layouts), a larger detector input for small
 * invoice text, and a lower drop threshold (the parser applies its own
 * confidence rules per line). recBatchSize 1: batched recognition (default 6)
 * returned empty/garbled text for some crops with these models.
 */
export const PADDLE_DETECTION = { maxSideLength: 1600 } as const;
export const PADDLE_RECOGNITION = { strategy: "per-box", minimumConfidence: 0.3, recBatchSize: 1 } as const;
