/**
 * Pure pixel operations on RGBA buffers (canvas ImageData layout). Shared by
 * the browser preprocessor and the Node evals so both see identical images.
 */

export interface EnhanceOptions {
  /** Convert to grayscale (default true). */
  grayscale?: boolean;
  /** Percentile-based contrast stretch strength 0..1 (default 1 = full auto-levels). */
  contrast?: number;
  /** Fraction of darkest/lightest pixels clipped by the stretch (default 0.01). */
  clip?: number;
}

/** In-place grayscale + auto-levels contrast stretch. */
export function enhanceRgba(data: Uint8ClampedArray | Uint8Array, opts: EnhanceOptions = {}): void {
  const { grayscale = true, contrast = 1, clip = 0.01 } = opts;
  const n = data.length / 4;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Rec. 601 luma, integer math.
    const y = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    lum[i] = y;
    hist[lum[i]]++;
  }
  let lo = 0;
  let hi = 255;
  if (contrast > 0) {
    const cut = Math.floor(n * clip);
    let acc = 0;
    while (lo < 255 && acc + hist[lo] <= cut) acc += hist[lo++];
    acc = 0;
    while (hi > 0 && acc + hist[hi] <= cut) acc += hist[hi--];
    if (hi - lo < 32) {
      // Nearly uniform image: stretching would only amplify noise.
      lo = 0;
      hi = 255;
    }
  }
  const range = Math.max(1, hi - lo);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const stretched = ((v - lo) * 255) / range;
    lut[v] = Math.max(0, Math.min(255, Math.round(v + (stretched - v) * contrast)));
  }
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (grayscale) {
      const v = lut[lum[i]];
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
    } else {
      data[p] = lut[data[p]];
      data[p + 1] = lut[data[p + 1]];
      data[p + 2] = lut[data[p + 2]];
    }
  }
}

/** Target size: long edge clamped to [minLong, maxLong] (upscale small screenshots a little). */
export function targetSize(
  w: number,
  h: number,
  maxLong = 2000,
  minLong = 1000,
): { width: number; height: number; scale: number } {
  const long = Math.max(w, h);
  let scale = 1;
  if (long > maxLong) scale = maxLong / long;
  else if (long < minLong) scale = Math.min(2, minLong / long);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}
