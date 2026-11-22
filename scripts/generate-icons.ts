/**
 * Generates PNG/ICO icons and the Open Graph image from the master mark SVG.
 * Run with `npm run icons`. Outputs are committed.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MARK = "M4 7.5H19.5V3.5L28.5 10L19.5 16.5V12.5H15.5V27.5H9.5V12.5H4Z";
const CLAY = "#D97757";
const TILE = "#1F1E1D";

/** Mark on a rounded-square tile. `inset` = fraction of the tile the mark occupies. */
function tileSvg(size: number, { inset = 0.68, radius = 0.22, rounded = true } = {}) {
  const markSize = size * inset;
  const offset = (size - markSize) / 2;
  const scale = markSize / 32;
  const r = rounded ? size * radius : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${TILE}"/>
  <g transform="translate(${offset} ${offset + size * 0.01}) scale(${scale})">
    <path d="${MARK}" fill="${CLAY}" stroke="${CLAY}" stroke-width="1.5" stroke-linejoin="round"/>
  </g></svg>`;
}

function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#262624"/>
  <g transform="translate(140 175) scale(7)">
    <path d="${MARK}" fill="${CLAY}" stroke="${CLAY}" stroke-width="1.5" stroke-linejoin="round"/>
  </g>
  <text x="420" y="320" font-family="Inter, Helvetica, Arial, sans-serif" font-size="120" font-weight="600" fill="#FAF9F5">TArrow</text>
  <text x="424" y="400" font-family="Inter, Helvetica, Arial, sans-serif" font-size="40" fill="#B0AEA5">Pay all your vendors in one go.</text>
</svg>`;
}

/** Minimal ICO container with embedded PNGs. */
function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

async function png(svg: string, size?: number, flatten = false) {
  let img = sharp(Buffer.from(svg));
  if (size) img = img.resize(size, size);
  if (flatten) img = img.flatten({ background: TILE });
  return img.png().toBuffer();
}

async function main() {
  const root = process.cwd();
  const pub = path.join(root, "public");
  const icons = path.join(pub, "icons");
  mkdirSync(icons, { recursive: true });

  const icoSizes = [16, 32, 48];
  const icoPngs = await Promise.all(icoSizes.map(async (s) => ({ size: s, data: await png(tileSvg(s, { inset: 0.78, radius: 0.2 })) })));
  writeFileSync(path.join(root, "src/app/favicon.ico"), buildIco(icoPngs));

  // Apple touch icon: no transparency (square, iOS rounds it).
  writeFileSync(path.join(pub, "apple-touch-icon.png"), await png(tileSvg(180, { rounded: false }), undefined, true));
  writeFileSync(path.join(icons, "icon-192.png"), await png(tileSvg(192)));
  writeFileSync(path.join(icons, "icon-512.png"), await png(tileSvg(512)));
  // Maskable: full-bleed tile, mark within the 80% safe zone (here 52%).
  writeFileSync(path.join(icons, "maskable-512.png"), await png(tileSvg(512, { inset: 0.52, rounded: false })));
  writeFileSync(path.join(pub, "og.png"), await sharp(Buffer.from(ogSvg())).png().toBuffer());
  console.log("icons generated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
