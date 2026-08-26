// One-off asset pipeline for the user-provided logo.png: recolors it from its original
// teal-to-blue gradient into the app's Persian Blue palette, then generates every size this
// project actually references (favicon, PWA manifest icon, and the full set of Android
// launcher/adaptive-icon mipmaps).
//
// Recoloring approach: a blind hue-rotate (tried first) doesn't map predictably — sharp/HSL hue
// rotation pushed the gradient into purple/magenta instead of blue. Instead, each pixel's
// saturation and hue are read directly (standard RGB->HSL) and used as blend factors: saturation
// picks how much of the original white is kept (0 = stays white, matching the source's
// antialiased edges and its near-black flattened corners once those are snapped toward white
// first), and hue position within the source's own teal(~175°)->blue(~213°) span picks where to
// sample between two explicit brand-palette anchors. This stays inside the actual Tailwind
// brand-* scale by construction, rather than hoping a rotation lands there.
//
// Not part of the app build — run manually (`node scripts/process-logo.mjs`) only when the
// source logo.png changes.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "public/logo.png";

// brand-300 and brand-600 from tailwind.config.ts — same hue family, so the gradient stays
// recognizably "Persian Blue" end to end instead of drifting hue like the rotation did.
const LIGHT = [134, 149, 227];
const DARK = [28, 57, 187];
const SOURCE_HUE_MIN = 170;
const SOURCE_HUE_MAX = 216;

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  if (delta === 0) return 0;
  let hue;
  if (max === r / 255) hue = 60 * (((g - b) / 255 / delta) % 6);
  else if (max === g / 255) hue = 60 * ((b - r) / 255 / delta + 2);
  else hue = 60 * ((r - g) / 255 / delta + 4);
  if (hue < 0) hue += 360;
  return hue;
}

// Plain distance from white in RGB space — NOT HSL saturation. Saturation's formula divides by
// (1 - |2L-1|), which goes to zero as lightness approaches white, so it amplifies even a 1-value
// PNG-noise wobble on a "white" pixel into a huge apparent saturation. Distance-from-white has no
// such singularity: a background pixel a few values off pure white stays correctly close to 0.
function distanceFromWhite(r, g, b) {
  const dr = 255 - r;
  const dg = 255 - g;
  const db = 255 - b;
  return Math.sqrt(dr * dr + dg * dg + db * db) / (255 * Math.sqrt(3));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

async function loadRecolored() {
  const img = sharp(SRC);
  const { width, height } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const out = Buffer.alloc(raw.length);

  for (let i = 0; i < raw.length; i += 3) {
    let r = raw[i];
    let g = raw[i + 1];
    let b = raw[i + 2];
    // Snap the source's flattened-to-black "outside the rounded corners" area to white first,
    // same as it'll read visually once actually clipped to a rounded shape anywhere else.
    if (r < 20 && g < 20 && b < 20) {
      r = g = b = 254;
    }

    const hue = rgbToHue(r, g, b);
    const huePos = Math.min(1, Math.max(0, (hue - SOURCE_HUE_MIN) / (SOURCE_HUE_MAX - SOURCE_HUE_MIN)));
    const target = [lerp(LIGHT[0], DARK[0], huePos), lerp(LIGHT[1], DARK[1], huePos), lerp(LIGHT[2], DARK[2], huePos)];

    // Background/noise pixels sit within a few RGB values of white (dist near 0); real swirl
    // pixels (fully-saturated teal/blue) sit far from white. A wide dead zone before ramping up
    // keeps any residual compression noise from ever reaching visible strength.
    const dist = distanceFromWhite(r, g, b);
    const DIST_FLOOR = 0.12;
    const DIST_CEIL = 0.35;
    // The source's black-corners-snapped-to-white step left a thin antialiased black->white
    // seam along the rounded-corner boundary — those pixels are gray (far from white, so `dist`
    // alone would color them), not swirl-colored. Chroma (max-min channel spread) is ~0 for any
    // gray, so gating on it excludes that seam without touching the actual teal/blue swirl.
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const alpha = dist <= DIST_FLOOR || chroma < 0.08 ? 0 : Math.min(1, (dist - DIST_FLOOR) / (DIST_CEIL - DIST_FLOOR));
    out[i] = Math.round(lerp(254, target[0], alpha));
    out[i + 1] = Math.round(lerp(254, target[1], alpha));
    out[i + 2] = Math.round(lerp(254, target[2], alpha));
  }

  return sharp(out, { raw: { width, height, channels: 3 } }).png();
}

async function main() {
  const recolored = await loadRecolored();
  const buffer = await recolored.toBuffer();

  mkdirSync("public", { recursive: true });
  await sharp(buffer).resize(512, 512).toFile("public/icon.png");
  await sharp(buffer).resize(1254, 1254).toFile("public/logo-recolored.png");

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
    const padEnd = canvas - artSize - padStart; // absorbs any odd/even rounding remainder
    // Two separate pipelines, not one chain: sharp only honors the LAST .resize() call in a
    // chain (an earlier one is silently discarded, and .extend() always applies against
    // whatever that final target was) — chaining resize->extend->resize here produced a
    // 580px result where 432 was expected. Materializing the shrink to its own buffer first
    // avoids that entirely.
    const shrunk = await sharp(buffer).resize(artSize, artSize).toBuffer();
    const fg = await sharp(shrunk)
      .extend({ top: padStart, bottom: padEnd, left: padStart, right: padEnd, background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .toBuffer();
    mkdirSync(dir, { recursive: true });
    await sharp(fg).toFile(`${dir}/ic_launcher_foreground.png`);
  }

  console.log("Wrote public/icon.png, public/logo-recolored.png, and Android mipmap-* icons.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
