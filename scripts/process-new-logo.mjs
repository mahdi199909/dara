// Recolors public/new_logo.png (a multi-color blue/purple/orange/yellow swirl with real alpha
// transparency already baked in) into a Persian Blue duotone, then generates the same icon set
// scripts/process-logo.mjs produces. Separate script because the approach differs: that source
// had no real alpha (background snapped-to-white + distance-from-white derived it) and used a
// hue-position blend between two anchors; this source already has correct alpha, so recoloring
// is a plain luminance->duotone remap (discard hue/saturation entirely) with alpha untouched.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "public/new_logo.png";
const DARK = [8, 13, 60]; // near-black Persian Blue, for the darkest source pixels
const LIGHT = [120, 138, 214]; // still clearly blue (brand-300-ish), not washed to near-white

function lerp(a, b, t) {
  return a + (b - a) * t;
}

async function loadRecolored() {
  const img = sharp(SRC);
  const { width, height } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const out = Buffer.alloc(raw.length);

  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    out[i] = Math.round(lerp(DARK[0], LIGHT[0], luminance));
    out[i + 1] = Math.round(lerp(DARK[1], LIGHT[1], luminance));
    out[i + 2] = Math.round(lerp(DARK[2], LIGHT[2], luminance));
    out[i + 3] = raw[i + 3]; // alpha untouched
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png();
}

async function main() {
  const recolored = await loadRecolored();
  const buffer = await recolored.toBuffer();

  mkdirSync("public", { recursive: true });
  await sharp(buffer).resize(512, 512).toFile("public/icon.png");

  const androidBase = "android/app/src/main/res";
  const legacySizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  const adaptiveSizes = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

  for (const [density, size] of Object.entries(legacySizes)) {
    const dir = `${androidBase}/mipmap-${density}`;
    mkdirSync(dir, { recursive: true });
    await sharp(buffer).resize(size, size).toFile(`${dir}/ic_launcher.png`);
    await sharp(buffer).resize(size, size).toFile(`${dir}/ic_launcher_round.png`);
  }

  for (const [density, canvas] of Object.entries(adaptiveSizes)) {
    const dir = `${androidBase}/mipmap-${density}`;
    const artSize = Math.round(canvas * 0.66);
    const padStart = Math.floor((canvas - artSize) / 2);
    const padEnd = canvas - artSize - padStart;
    // Two separate sharp() calls, not a chain — sharp only honors the LAST .resize() in a
    // chain, and .extend() applies against that final size regardless of chain position.
    const shrunk = await sharp(buffer).resize(artSize, artSize).toBuffer();
    const fg = await sharp(shrunk)
      .extend({ top: padStart, bottom: padEnd, left: padStart, right: padEnd, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    mkdirSync(dir, { recursive: true });
    await sharp(fg).toFile(`${dir}/ic_launcher_foreground.png`);
  }

  console.log("Wrote public/icon.png and Android mipmap-* icons from new_logo.png.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
