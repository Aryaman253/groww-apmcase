/**
 * CI check: fails if any English key is missing (or empty) in another locale,
 * or if a locale still has untranslated copies of English strings in main flows.
 * Run: npm run i18n:check
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type Tree = { [k: string]: string | Tree | Tree[] | string[] };
const dir = path.join(process.cwd(), "src/messages");
const en = JSON.parse(readFileSync(path.join(dir, "en.json"), "utf8")) as Tree;
const locales = ["hi"];

function flatten(t: unknown, prefix = "", out: Record<string, string> = {}) {
  if (typeof t === "string") out[prefix] = t;
  else if (Array.isArray(t)) t.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (t && typeof t === "object") for (const [k, v] of Object.entries(t)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

// Strings that are legitimately identical in Hindi (brand, codes, formats).
const ALLOWED_SAME = /^(TArrow|IFSC|GSTIN|UPI|UTR|OTP|PDF|Excel|CSV|RazorpayX|Cashfree|English|हिन्दी|₹|#|404|\{[a-z]+\}|[A-Z0-9 /().:·,{}-]+)$/;

let failed = false;
const enFlat = flatten(en);
for (const loc of locales) {
  const other = flatten(JSON.parse(readFileSync(path.join(dir, `${loc}.json`), "utf8")));
  const missing = Object.keys(enFlat).filter((k) => !(k in other) || !other[k].trim());
  const untranslated = Object.keys(enFlat).filter((k) => k in other && other[k] === enFlat[k] && /[a-z]{3,}/.test(enFlat[k]) && !ALLOWED_SAME.test(enFlat[k]));
  const extra = Object.keys(other).filter((k) => !(k in enFlat));
  if (missing.length) {
    failed = true;
    console.error(`✗ ${loc}: ${missing.length} missing keys\n  ` + missing.slice(0, 50).join("\n  "));
  }
  if (untranslated.length) {
    failed = true;
    console.error(`✗ ${loc}: ${untranslated.length} strings still in English\n  ` + untranslated.slice(0, 50).join("\n  "));
  }
  if (extra.length) console.warn(`! ${loc}: ${extra.length} keys not in en (ignored)`);
  if (!missing.length && !untranslated.length) console.log(`✓ ${loc}: all ${Object.keys(enFlat).length} keys translated`);
}
process.exit(failed ? 1 : 0);
