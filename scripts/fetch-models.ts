/**
 * Populates the same-origin OCR assets (all git-ignored):
 *
 *   public/models/paddle/  PaddleOCR PP-OCRv5 det + en rec/dict + devanagari rec/dict (Hugging Face)
 *   public/ort/            onnxruntime-web JSEP wasm (copied from node_modules)
 *   public/tesseract/      tesseract.js worker + LSTM cores + eng/hin traineddata.gz (node_modules)
 *
 * Idempotent (skips files that are already present with the right size) and
 * never fails the build: on network or copy errors it warns and exits 0, so it
 * is safe as a Vercel `prebuild`. The app then falls back to the Hugging Face
 * URL for Paddle models at runtime.
 *
 * Usage: npm run models:fetch   (FORCE=1 to re-download)
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  ORT_FILES,
  PADDLE_ASSETS,
  PADDLE_HF_BASE,
  TESSERACT_FILES,
  TESSERACT_LANGS,
} from "../src/lib/ocr/assets";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const PADDLE_DIR = path.join(PUBLIC, "models", "paddle");
const ORT_DIR = path.join(PUBLIC, "ort");
const TESS_DIR = path.join(PUBLIC, "tesseract");
const TESS_LANG_DIR = path.join(TESS_DIR, "lang");
const FORCE = process.env.FORCE === "1";
const require_ = createRequire(path.join(ROOT, "package.json"));

let warnings = 0;
function warn(msg: string) {
  warnings++;
  console.warn(`[models:fetch] WARN ${msg}`);
}
function log(msg: string) {
  console.log(`[models:fetch] ${msg}`);
}

function sizeOf(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return -1;
  }
}

async function download(url: string, dest: string): Promise<void> {
  if (!FORCE && sizeOf(dest) > 0) {
    log(`skip ${path.relative(ROOT, dest)} (present)`);
    return;
  }
  const tmp = `${dest}.part`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const expected = Number(res.headers.get("content-length") ?? 0);
      if (expected && buf.length !== expected && !res.headers.get("content-encoding")) {
        throw new Error(`size mismatch ${buf.length} != ${expected}`);
      }
      if (buf.length === 0) throw new Error("empty body");
      writeFileSync(tmp, buf);
      renameSync(tmp, dest);
      log(`downloaded ${path.relative(ROOT, dest)} (${fmt(buf.length)})`);
      return;
    } catch (e) {
      if (existsSync(tmp)) unlinkSync(tmp);
      if (attempt === 3) {
        warn(`could not download ${url}: ${String(e)} — runtime will fall back to Hugging Face`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function copy(src: string, dest: string): void {
  try {
    if (!existsSync(src)) {
      warn(`missing source ${path.relative(ROOT, src)}`);
      return;
    }
    if (!FORCE && sizeOf(dest) === sizeOf(src)) {
      log(`skip ${path.relative(ROOT, dest)} (up to date)`);
      return;
    }
    copyFileSync(src, dest);
    log(`copied ${path.relative(ROOT, dest)} (${fmt(sizeOf(dest))})`);
  } catch (e) {
    warn(`copy failed ${src}: ${String(e)}`);
  }
}

function pkgDir(name: string): string | null {
  try {
    return path.dirname(require_.resolve(`${name}/package.json`));
  } catch {
    // Packages with an `exports` map (e.g. onnxruntime-web) hide package.json.
    const direct = path.join(ROOT, "node_modules", name);
    if (existsSync(path.join(direct, "package.json"))) return direct;
    warn(`package ${name} not installed`);
    return null;
  }
}

function fmt(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : sizeOf(p);
  }
  return total;
}

async function main() {
  for (const d of [PADDLE_DIR, ORT_DIR, TESS_DIR, TESS_LANG_DIR]) mkdirSync(d, { recursive: true });

  // 1. Paddle models (network). Sequential to stay friendly with HF rate limits.
  for (const asset of Object.values(PADDLE_ASSETS)) {
    await download(`${PADDLE_HF_BASE}/${asset.remote}`, path.join(PADDLE_DIR, asset.file));
  }

  // 2. onnxruntime-web wasm (local copy).
  const ortDir = pkgDir("onnxruntime-web");
  if (ortDir) for (const f of ORT_FILES) copy(path.join(ortDir, "dist", f), path.join(ORT_DIR, f));

  // 3. Tesseract worker + core + traineddata (local copy).
  const tjs = pkgDir("tesseract.js");
  const core = pkgDir("tesseract.js-core");
  if (tjs) copy(path.join(tjs, "dist", "worker.min.js"), path.join(TESS_DIR, "worker.min.js"));
  if (core) {
    for (const f of TESSERACT_FILES.filter((f) => f !== "worker.min.js")) {
      copy(path.join(core, f), path.join(TESS_DIR, f));
    }
  }
  for (const lang of TESSERACT_LANGS) {
    const dataDir = pkgDir(`@tesseract.js-data/${lang}`);
    // LSTM-only "best_int" models, gzip-compressed (tesseract.js fetches `${lang}.traineddata.gz`).
    if (dataDir) {
      copy(path.join(dataDir, "4.0.0_best_int", `${lang}.traineddata.gz`), path.join(TESS_LANG_DIR, `${lang}.traineddata.gz`));
    }
  }

  log(
    `sizes: public/models ${fmt(dirSize(path.join(PUBLIC, "models")))}, ` +
      `public/ort ${fmt(dirSize(ORT_DIR))}, public/tesseract ${fmt(dirSize(TESS_DIR))}`,
  );
  if (warnings) log(`finished with ${warnings} warning(s); OCR will use runtime fallbacks where possible`);
}

// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (read at startup),
// so re-run ourselves once with it set when a proxy is configured.
const proxied = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxied && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  if (r.error) warn(`re-exec with proxy failed: ${String(r.error)}`);
  process.exit(0);
}

main()
  .catch((e) => warn(`unexpected error: ${String(e)}`))
  .finally(() => process.exit(0));
