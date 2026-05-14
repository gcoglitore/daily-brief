#!/usr/bin/env node
// Regenerate public/og-image.png from public/og-image.svg.
//
// Run when the SVG changes (branding/tagline edit). Output is checked into
// the repo because the OG image is static — re-rendering every CI run would
// just bloat git history with byte-identical PNGs.
//
// Usage:
//   npm install --no-save sharp
//   node scripts/regen-og.js
const path = require("path");
let sharp;
try {
  sharp = require("sharp");
} catch (e) {
  console.error(
    'sharp is not installed. Run:\n  npm install --no-save sharp\nthen re-run this script.'
  );
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const src = path.join(root, "public", "og-image.svg");
const dst = path.join(root, "public", "og-image.png");

sharp(src)
  .resize(1200, 630)
  .png({ quality: 90, compressionLevel: 9 })
  .toFile(dst)
  .then((info) => {
    console.log(`Wrote ${dst} (${info.size} bytes, ${info.width}x${info.height})`);
  })
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exit(1);
  });
