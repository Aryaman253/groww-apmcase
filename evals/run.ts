/**
 * Auto-fill evals: runs the production parser (and the same OCR models) over
 * the synthetic fixtures and writes evals/results.md.
 *
 *   npm run eval            (expects `npm run models:fetch` to have run)
 *   SKIP_OCR=1 npm run eval (parser-only: pasted text + PDF text layers)
 *
 * Primary pipeline = what the app does: paste → parser; PDF → text layer →
 * parser; image → preprocess → PaddleOCR → parser. Tesseract is run on the same
 * preprocessed images for comparison only.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PARSER_VERSION, CONFIDENT, parseInvoiceText, parseVendorText } from "../src/lib/extract/parser";
import type { FieldResult } from "../src/lib/extract/types";
import { PADDLE_ASSETS } from "../src/lib/ocr/assets";
import type { OcrResult } from "../src/lib/ocr/reading-order";
import { hasUsableText } from "../src/lib/ocr/pdf-text";
import { looksGarbledDevanagari } from "../src/lib/extract/normalize";
import type { FixtureSpec } from "./types";
import {
  ocrPaddleNode,
  ocrTesseractNode,
  pdfTextNode,
  preprocessNode,
  renderPdfPagesNode,
  shutdownOcr,
  warmPaddle,
  warmTesseract,
} from "./node-ocr";

const FIX = path.join(__dirname, "fixtures");
const OUT = path.join(__dirname, "results.md");
const SKIP_OCR = process.env.SKIP_OCR === "1";

type Pipeline = "text" | "pdf-text" | "pdf-ocr" | "paddle" | "tesseract";

interface FieldOutcome {
  fixture: string;
  pipeline: Pipeline;
  kind: FixtureSpec["kind"];
  field: string;
  expected: string | number | null;
  got: string | number | null;
  confidence: number;
  candidates: (string | number)[];
  correct: boolean;
  confidentError: boolean;
  candidatesOk: boolean | null;
}

interface DocOutcome {
  fixture: string;
  pipeline: Pipeline;
  kind: FixtureSpec["kind"];
  exact: boolean;
  ms: number;
  tokenRecall?: number;
  ocrConfidence?: number;
}

function norm(field: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (field === "accountHolderName" || field === "vendorName" || field === "bankName") {
    return s.toLowerCase().replace(/^m\s*\/\s*s\.?\s*/u, "").replace(/[^\p{L}\p{N}\p{M}]/gu, "");
  }
  if (field === "invoiceNumber") return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.toLowerCase();
}

function tokenRecall(truth: string, got: string): number {
  const tok = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}\p{M}@./-]+/u).filter((x) => x.length >= 2);
  const have = new Map<string, number>();
  for (const t of tok(got)) have.set(t, (have.get(t) ?? 0) + 1);
  const want = tok(truth);
  let hit = 0;
  for (const t of want) {
    const n = have.get(t) ?? 0;
    if (n > 0) {
      hit++;
      have.set(t, n - 1);
    }
  }
  return want.length ? hit / want.length : 1;
}

function score(spec: FixtureSpec, pipeline: Pipeline, fields: Record<string, FieldResult<string | number>>, ms: number, extra: Partial<DocOutcome> = {}) {
  const outcomes: FieldOutcome[] = [];
  for (const [field, expected] of Object.entries(spec.expected)) {
    const r = fields[field];
    const got = r?.value ?? null;
    const correct = norm(field, got) === norm(field, expected);
    const wantCands = spec.candidates?.[field];
    const candidatesOk = wantCands
      ? wantCands.every((c) => (r?.candidates ?? []).some((x) => norm(field, x) === norm(field, c)))
      : null;
    outcomes.push({
      fixture: spec.id,
      pipeline,
      kind: spec.kind,
      field,
      expected,
      got,
      confidence: r?.confidence ?? 0,
      candidates: r?.candidates ?? [],
      correct,
      confidentError: !correct && got !== null && (r?.confidence ?? 0) >= CONFIDENT,
      candidatesOk,
    });
  }
  const doc: DocOutcome = { fixture: spec.id, pipeline, kind: spec.kind, exact: outcomes.every((o) => o.correct), ms, ...extra };
  return { outcomes, doc };
}

function parse(spec: FixtureSpec, text: string, ocr?: OcrResult) {
  const opts = ocr ? { ocrLineConfidences: ocr.lines.map((l) => l.confidence), ocrWordConfidence: ocr.avgConfidence } : {};
  return (spec.kind === "vendor" ? parseVendorText(text, opts) : parseInvoiceText(text, opts)) as unknown as Record<
    string,
    FieldResult<string | number>
  >;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

interface Agg {
  fields: number;
  correct: number;
  nullExpected: number;
  nullCorrect: number;
  valueExpected: number;
  valueCorrect: number;
  wrongValue: number;
  confidentErrors: number;
  confidentValues: number;
  confidentCorrect: number;
  docs: number;
  exact: number;
  ambiguityCases: number;
  ambiguitySurfaced: number;
}

function aggregate(fs: FieldOutcome[], ds: DocOutcome[]): Agg {
  const a: Agg = {
    fields: fs.length,
    correct: fs.filter((f) => f.correct).length,
    nullExpected: fs.filter((f) => f.expected === null).length,
    nullCorrect: fs.filter((f) => f.expected === null && f.got === null).length,
    valueExpected: fs.filter((f) => f.expected !== null).length,
    valueCorrect: fs.filter((f) => f.expected !== null && f.correct).length,
    wrongValue: fs.filter((f) => f.got !== null && !f.correct).length,
    confidentErrors: fs.filter((f) => f.confidentError).length,
    confidentValues: fs.filter((f) => f.got !== null && f.confidence >= CONFIDENT).length,
    confidentCorrect: fs.filter((f) => f.got !== null && f.confidence >= CONFIDENT && f.correct).length,
    docs: ds.length,
    exact: ds.filter((d) => d.exact).length,
    ambiguityCases: fs.filter((f) => f.candidatesOk !== null).length,
    ambiguitySurfaced: fs.filter((f) => f.candidatesOk === true && f.got === null).length,
  };
  return a;
}

function row(name: string, a: Agg): string {
  return `| ${name} | ${a.docs} | ${pct(a.correct, a.fields)} | ${pct(a.exact, a.docs)} | ${pct(a.valueCorrect, a.valueExpected)} | ${pct(a.nullCorrect, a.nullExpected)} | ${a.wrongValue} | **${a.confidentErrors}** | ${pct(a.confidentCorrect, a.confidentValues)} | ${a.ambiguityCases ? `${a.ambiguitySurfaced}/${a.ambiguityCases}` : "–"} |`;
}

const fmtVal = (field: string, v: unknown) =>
  v === null || v === undefined ? "∅" : field === "totalPaise" && typeof v === "number" ? `₹${(v / 100).toFixed(2)}` : `\`${String(v)}\``;

async function main() {
  const specs: FixtureSpec[] = readdirSync(FIX)
    .filter((f) => f.endsWith(".expected.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(FIX, f), "utf8")));
  if (!specs.length) throw new Error("No fixtures. Run: npx tsx evals/generate-fixtures.ts");

  const modelsPresent = Object.values(PADDLE_ASSETS).every((a) => existsSync(path.join(__dirname, "..", "public", "models", "paddle", a.file)));
  const tessPresent = existsSync(path.join(__dirname, "..", "public", "tesseract", "lang", "eng.traineddata.gz"));
  const runOcr = !SKIP_OCR && modelsPresent;
  if (!SKIP_OCR && !modelsPresent) console.warn("[eval] Paddle models missing (npm run models:fetch) — skipping OCR fixtures");

  const fields: FieldOutcome[] = [];
  const docs: DocOutcome[] = [];
  const warm: Record<string, number> = {};

  for (const spec of specs) {
    const file = path.join(FIX, spec.file);
    if (spec.sourceType === "paste") {
      const text = readFileSync(file, "utf8");
      const t0 = performance.now();
      const r = parse(spec, text);
      const s = score(spec, "text", r, performance.now() - t0);
      fields.push(...s.outcomes);
      docs.push(s.doc);
    } else if (spec.sourceType === "pdf") {
      const t0 = performance.now();
      const buf = readFileSync(file);
      let text = await pdfTextNode(buf);
      let ocr: OcrResult | undefined;
      let pipeline: Pipeline = "pdf-text";
      // Same rule as the browser (src/lib/ocr/index.ts): no/garbled text layer → render + OCR.
      const garbled = text.split("\n").filter(looksGarbledDevanagari).length >= 2;
      if ((!hasUsableText(text) || garbled) && runOcr) {
        const pages = await renderPdfPagesNode(buf);
        warm[`paddle-${spec.lang}`] ??= await warmPaddle(spec.lang);
        const results = [];
        for (const png of pages) results.push(await ocrPaddleNode((await preprocessNode(png)).png, garbled ? "hi" : spec.lang));
        const lines = results.flatMap((r) => r.lines);
        ocr = { text: results.map((r) => r.text).join("\n"), lines, engine: "paddle", avgConfidence: lines.reduce((a, l) => a + l.confidence, 0) / Math.max(1, lines.length) };
        text = ocr.text;
        pipeline = "pdf-ocr";
      }
      const r = parse(spec, text, ocr);
      const s = score(spec, pipeline, r, performance.now() - t0, { tokenRecall: spec.groundTruthText ? tokenRecall(spec.groundTruthText, text) : undefined });
      fields.push(...s.outcomes);
      docs.push(s.doc);
    } else if (runOcr) {
      const raw = readFileSync(file);
      const pre = await preprocessNode(raw);
      warm[`paddle-${spec.lang}`] ??= await warmPaddle(spec.lang);
      const pr = await ocrPaddleNode(pre.png, spec.lang);
      const ps = score(spec, "paddle", parse(spec, pr.text, pr), pr.ms ?? 0, {
        tokenRecall: tokenRecall(spec.groundTruthText ?? "", pr.text),
        ocrConfidence: pr.avgConfidence,
      });
      fields.push(...ps.outcomes);
      docs.push(ps.doc);
      if (process.env.DEBUG_OCR) console.log(`--- ${spec.id} [paddle]\n${pr.text}`);
      if (tessPresent) {
        warm[`tesseract-${spec.lang}`] ??= await warmTesseract(spec.lang);
        const tr = await ocrTesseractNode(pre.png, spec.lang);
        const ts = score(spec, "tesseract", parse(spec, tr.text, tr), tr.ms ?? 0, {
          tokenRecall: tokenRecall(spec.groundTruthText ?? "", tr.text),
          ocrConfidence: tr.avgConfidence,
        });
        fields.push(...ts.outcomes);
        docs.push(ts.doc);
        if (process.env.DEBUG_OCR) console.log(`--- ${spec.id} [tesseract]\n${tr.text}`);
      }
    }
  }
  await shutdownOcr();

  // ── report ──
  const primary = (p: Pipeline) => p !== "tesseract";
  const sel = (pred: (f: { pipeline: Pipeline; kind: string }) => boolean) =>
    aggregate(fields.filter(pred), docs.filter(pred));
  const A = {
    all: sel((x) => primary(x.pipeline)),
    text: sel((x) => x.pipeline === "text" || x.pipeline === "pdf-text"),
    ocr: sel((x) => x.pipeline === "paddle" || x.pipeline === "pdf-ocr"),
    vendor: sel((x) => primary(x.pipeline) && x.kind === "vendor"),
    invoice: sel((x) => primary(x.pipeline) && x.kind === "invoice"),
    paddle: sel((x) => x.pipeline === "paddle"),
    tesseract: sel((x) => x.pipeline === "tesseract"),
  };

  const fieldNames = [...new Set(fields.map((f) => `${f.kind}.${f.field}`))];
  const perField = fieldNames.map((fname) => {
    const [kind, field] = fname.split(".");
    const pf = fields.filter((f) => primary(f.pipeline) && f.kind === kind && f.field === field);
    const ce = pf.filter((f) => f.confidentError).length;
    const t = (p: Pipeline[]) => {
      const xs = fields.filter((f) => p.includes(f.pipeline) && f.kind === kind && f.field === field);
      return xs.length ? `${xs.filter((x) => x.correct).length}/${xs.length}` : "–";
    };
    return `| ${kind} | ${field} | ${pct(pf.filter((f) => f.correct).length, pf.length)} | ${t(["text", "pdf-text"])} | ${t(["paddle", "pdf-ocr"])} | ${t(["tesseract"])} | ${ce} |`;
  });

  const engineRow = (p: Pipeline) => {
    const ds = docs.filter((d) => d.pipeline === p);
    const fs = fields.filter((f) => f.pipeline === p);
    if (!ds.length) return `| ${p} | – | – | – | – | – | – |`;
    const recall = ds.reduce((s, d) => s + (d.tokenRecall ?? 0), 0) / ds.length;
    const conf = ds.reduce((s, d) => s + (d.ocrConfidence ?? 0), 0) / ds.length;
    const warmMs = Object.entries(warm)
      .filter(([k]) => k.startsWith(p))
      .map(([k, v]) => `${k.split("-")[1]}: ${(v / 1000).toFixed(1)}s`)
      .join(", ");
    return `| ${p} | ${ds.length} | ${pct(fs.filter((f) => f.correct).length, fs.length)} | ${fs.filter((f) => f.confidentError).length} | ${(recall * 100).toFixed(1)}% | ${conf.toFixed(3)} | ${Math.round(median(ds.map((d) => d.ms)))} ms (max ${Math.round(Math.max(...ds.map((d) => d.ms)))}) | ${warmMs || "–"} |`;
  };

  const failures = fields
    .filter((f) => !f.correct || f.candidatesOk === false)
    .sort((a, b) => Number(b.confidentError) - Number(a.confidentError) || a.fixture.localeCompare(b.fixture));
  const failLines = failures.map(
    (f) =>
      `| ${f.confidentError ? "⚠️ " : ""}${f.fixture} | ${f.pipeline} | ${f.field} | ${fmtVal(f.field, f.expected)} | ${fmtVal(f.field, f.got)} | ${f.confidence.toFixed(2)} | ${f.candidates.length ? f.candidates.map((c) => fmtVal(f.field, c)).join(", ") : "–"} |`,
  );

  const md = `# Auto-fill eval results

- **Parser version:** \`${PARSER_VERSION}\`
- **Run date:** ${new Date().toISOString().slice(0, 10)}
- **Fixtures:** ${specs.length} (${specs.filter((s) => s.kind === "vendor").length} vendor-detail messages, ${specs.filter((s) => s.kind === "invoice").length} invoices; ${specs.filter((s) => s.sourceType === "paste").length} pasted text, ${specs.filter((s) => s.sourceType === "image").length} images, ${specs.filter((s) => s.sourceType === "pdf").length} PDFs) — all synthetic, see \`evals/generate-fixtures.ts\`
- **OCR:** ${runOcr ? `PaddleOCR PP-OCRv5 mobile (en; + devanagari rec for \`hi\`) via onnxruntime-node${tessPresent ? "; Tesseract.js 7 LSTM (eng/hin best_int) for comparison" : ""}` : "skipped"}
- **Node:** ${process.version} (CPU). Browser timings differ (WASM/WebGPU).
- Confident = confidence ≥ ${CONFIDENT}. A **confident error** is a wrong (or should-be-null) value returned with confidence ≥ ${CONFIDENT}.

## Summary (production pipeline: paste → parser, PDF → text layer, image → PaddleOCR)

| Slice | Docs | Field accuracy | Exact-match docs | Filled correctly (value expected) | Null-correct (absent/ambiguous) | Wrong values | Confident errors | Precision of confident values | Ambiguity surfaced as candidates |
|---|---|---|---|---|---|---|---|---|---|
${row("All", A.all)}
${row("Text-only (paste + PDF text layer)", A.text)}
${row("OCR (images + garbled/no-text PDFs, PaddleOCR)", A.ocr)}
${row("Vendor details", A.vendor)}
${row("Invoices", A.invoice)}

## PaddleOCR vs Tesseract (same preprocessed images)

| Engine | Images | Field accuracy | Confident errors | OCR token recall | Mean OCR conf | Median time / image | Model load |
|---|---|---|---|---|---|---|---|
${engineRow("paddle")}
${engineRow("tesseract")}

## Per-field accuracy

| Kind | Field | Accuracy (primary) | Text-only | PaddleOCR | Tesseract | Confident errors (primary) |
|---|---|---|---|---|---|---|
${perField.join("\n")}

## Failures (${failures.length})

${failures.length ? `| Fixture | Pipeline | Field | Expected | Got | Conf | Candidates |\n|---|---|---|---|---|---|---|\n${failLines.join("\n")}` : "None."}

⚠️ = confident error.
`;
  writeFileSync(OUT, md);
  console.log(md.split("## Per-field")[0]);
  console.log(`[eval] wrote ${path.relative(process.cwd(), OUT)} — ${failures.length} failing field(s), ${A.all.confidentErrors} confident error(s) (primary), ${A.tesseract.confidentErrors} (tesseract)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
