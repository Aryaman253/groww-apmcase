/** Messages between the page (index.ts) and ocr.worker.ts. */
import type { CropRect, OcrLang } from "../extract/types";
import type { OcrResult } from "./reading-order";

export type WorkerRequest =
  | { id: number; type: "warmup"; lang: OcrLang }
  | { id: number; type: "ocr"; image: Blob; lang: OcrLang; crop?: CropRect; enhance?: boolean };

export type WorkerResponse =
  | { id: number; type: "progress"; stage: "loading" | "reading" }
  | { id: number; type: "done"; result: OcrResult; backend: string }
  | { id: number; type: "error"; code: "paddle-unavailable" | "ocr-failed"; message: string };
