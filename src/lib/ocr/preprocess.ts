/**
 * Browser image preprocessing for OCR. Runs on the main thread or inside a
 * worker (OffscreenCanvas when available, else a DOM canvas):
 *   EXIF orientation → optional crop → resize (long edge ≤ 2000px, small
 *   screenshots upscaled a little) → optional grayscale + contrast stretch.
 */
import type { CropRect } from "../extract/types";
import { enhanceRgba, targetSize, type EnhanceOptions } from "./enhance";

export interface PreprocessOptions extends EnhanceOptions {
  /** Crop as fractions (0..1) of the oriented image. */
  crop?: CropRect;
  /** Max long edge in px (default 2000). */
  maxSide?: number;
  /** Small images are upscaled towards this long edge (default 1000, at most 2x). */
  minSide?: number;
  /** Apply grayscale/contrast enhancement (default false; see evals). */
  enhance?: boolean;
}

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export interface Preprocessed {
  canvas: AnyCanvas;
  width: number;
  height: number;
  /** output px / oriented-source px */
  scale: number;
}

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: AnyCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/** Decodes with EXIF orientation applied (createImageBitmap "from-image"). */
export async function decodeImage(source: Blob | ImageBitmap): Promise<ImageBitmap> {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) return source;
  try {
    return await createImageBitmap(source as Blob, { imageOrientation: "from-image" });
  } catch {
    // Older Safari: no options bag. Browsers apply EXIF orientation by default nowadays.
    return await createImageBitmap(source as Blob);
  }
}

export async function preprocessImage(source: Blob | ImageBitmap, opts: PreprocessOptions = {}): Promise<Preprocessed> {
  const bmp = await decodeImage(source);
  const c = opts.crop;
  const sx = c ? Math.max(0, Math.round(c.x * bmp.width)) : 0;
  const sy = c ? Math.max(0, Math.round(c.y * bmp.height)) : 0;
  const sw = c ? Math.max(1, Math.min(bmp.width - sx, Math.round(c.width * bmp.width))) : bmp.width;
  const sh = c ? Math.max(1, Math.min(bmp.height - sy, Math.round(c.height * bmp.height))) : bmp.height;
  const { width, height, scale } = targetSize(sw, sh, opts.maxSide ?? 2000, opts.minSide ?? 1000);

  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff"; // transparent PNGs → white paper
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, width, height);
  if (!(source instanceof Blob)) {
    // caller owns the bitmap
  } else bmp.close();

  if (opts.enhance) {
    const img = ctx.getImageData(0, 0, width, height);
    enhanceRgba(img.data, opts);
    ctx.putImageData(img, 0, 0);
  }
  return { canvas, width, height, scale };
}

/** Canvas → PNG Blob (works for OffscreenCanvas and HTMLCanvasElement). */
export async function canvasToBlob(canvas: AnyCanvas, type = "image/png"): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type),
  );
}
