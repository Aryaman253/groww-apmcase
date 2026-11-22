/// <reference lib="webworker" />
/**
 * Self-hosted pdf.js worker: bundling the worker module here (instead of a
 * CDN workerSrc) keeps PDF parsing same-origin. index.ts passes this worker
 * to pdf.js via GlobalWorkerOptions.workerPort.
 */
import "pdfjs-dist/build/pdf.worker.min.mjs";
