# Auto-fill eval results

- **Parser version:** `1.0.1`
- **Run date:** 2026-11-22
- **Fixtures:** 40 (25 vendor-detail messages, 15 invoices; 19 pasted text, 14 images, 7 PDFs) — all synthetic, see `evals/generate-fixtures.ts`
- **OCR:** PaddleOCR PP-OCRv5 mobile (en; + devanagari rec for `hi`) via onnxruntime-node; Tesseract.js 7 LSTM (eng/hin best_int) for comparison
- **Node:** v22.23.5 (CPU). Browser timings differ (WASM/WebGPU).
- Confident = confidence ≥ 0.8. A **confident error** is a wrong (or should-be-null) value returned with confidence ≥ 0.8.

## Summary (production pipeline: paste → parser, PDF → text layer, image → PaddleOCR)

| Slice | Docs | Field accuracy | Exact-match docs | Filled correctly (value expected) | Null-correct (absent/ambiguous) | Wrong values | Confident errors | Precision of confident values | Ambiguity surfaced as candidates |
|---|---|---|---|---|---|---|---|---|---|
| All | 40 | 98.4% | 87.5% | 97.2% | 100.0% | 2 | **0** | 100.0% | 6/6 |
| Text-only (paste + PDF text layer) | 25 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | **0** | 100.0% | 5/5 |
| OCR (images + garbled/no-text PDFs, PaddleOCR) | 15 | 95.5% | 66.7% | 93.3% | 100.0% | 2 | **0** | 100.0% | 1/1 |
| Vendor details | 25 | 98.5% | 88.0% | 96.9% | 100.0% | 1 | **0** | 100.0% | 5/5 |
| Invoices | 15 | 98.1% | 86.7% | 97.6% | 100.0% | 1 | **0** | 100.0% | 1/1 |

## PaddleOCR vs Tesseract (same preprocessed images)

| Engine | Images | Field accuracy | Confident errors | OCR token recall | Mean OCR conf | Median time / image | Model load |
|---|---|---|---|---|---|---|---|
| paddle | 14 | 95.2% | 0 | 94.5% | 0.982 | 589 ms (max 992) | hi: 0.3s, en: 0.0s |
| tesseract | 14 | 97.1% | 0 | 95.8% | 0.894 | 451 ms (max 764) | en: 0.5s, hi: 0.3s |

## Per-field accuracy

| Kind | Field | Accuracy (primary) | Text-only | PaddleOCR | Tesseract | Confident errors (primary) |
|---|---|---|---|---|---|---|
| invoice | vendorGstin | 100.0% | 6/6 | 9/9 | 7/8 | 0 |
| invoice | vendorName | 93.3% | 6/6 | 8/9 | 8/8 | 0 |
| invoice | invoiceNumber | 93.3% | 6/6 | 8/9 | 8/8 | 0 |
| invoice | invoiceDate | 100.0% | 6/6 | 9/9 | 8/8 | 0 |
| invoice | dueDate | 100.0% | 6/6 | 9/9 | 8/8 | 0 |
| invoice | totalPaise | 100.0% | 6/6 | 9/9 | 8/8 | 0 |
| invoice | creditDays | 100.0% | 6/6 | 9/9 | 8/8 | 0 |
| vendor | accountHolderName | 96.0% | 19/19 | 5/6 | 5/6 | 0 |
| vendor | accountNumber | 92.0% | 19/19 | 4/6 | 6/6 | 0 |
| vendor | ifsc | 100.0% | 19/19 | 6/6 | 5/6 | 0 |
| vendor | bankName | 100.0% | 19/19 | 6/6 | 6/6 | 0 |
| vendor | upiId | 100.0% | 19/19 | 6/6 | 6/6 | 0 |
| vendor | gstin | 100.0% | 19/19 | 6/6 | 6/6 | 0 |
| vendor | phone | 100.0% | 19/19 | 6/6 | 6/6 | 0 |
| vendor | email | 100.0% | 19/19 | 6/6 | 6/6 | 0 |

## Failures (8)

| Fixture | Pipeline | Field | Expected | Got | Conf | Candidates |
|---|---|---|---|---|---|---|
| i10-hindi-png | paddle | vendorName | `अन्नपूर्णा किराना (डेमो)` | ∅ | 0.00 | `अत्रपूर्णा कि रा ना ( डेमो)`, `अज्नपू्णा किराना (डेमो)` |
| i13-combined-no-date | paddle | invoiceNumber | `TI-00042` | `Tl-00042` | 0.70 | `Tl-00042` |
| i15-receipt-narrow | tesseract | vendorGstin | `07ABJPS6666T1ZD` | ∅ | 0.00 | – |
| v20-cheque-hdfc | paddle | accountNumber | `50200012345678` | ∅ | 0.00 | – |
| v21-cheque-sbi-photo | paddle | accountNumber | `301234567890` | ∅ | 0.00 | – |
| v21-cheque-sbi-photo | tesseract | ifsc | `SBIN0012345` | ∅ | 0.00 | – |
| v24-hindi-screenshot | paddle | accountHolderName | `अन्नपूर्णा किराना (डेमो)` | `अन्रपूर्णा किराना (डेमो)` | 0.75 | `अन्रपूर्णा किराना (डेमो)` |
| v24-hindi-screenshot | tesseract | accountHolderName | `अन्नपूर्णा किराना (डेमो)` | `अन्नपूर्णा किराना (SHY)` | 0.75 | `अन्नपूर्णा किराना (SHY)` |

⚠️ = confident error.
