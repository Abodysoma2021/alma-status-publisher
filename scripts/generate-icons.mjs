/**
 * Generates build/icon.png (1024px), build/icon.icns and build/icon.ico
 * from the official Alma logo over the brand-ink background.
 *
 * The wordmark SVG is rendered onto a deep-ink rounded canvas with the
 * brand gradient underneath.
 */
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BUILD = path.join(ROOT, 'build');
const LOGO = path.join(ROOT, 'public/brand/alma-logo.svg');
mkdirSync(BUILD, { recursive: true });

const W = 1024;
const H = 1024;

// Brand-ink background with a subtle teal→indigo radial glow (from the palette).
const background = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="30%" cy="20%" r="90%">
      <stop offset="0%" stop-color="#12333b"/>
      <stop offset="55%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#080d18"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#0d9488" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#4f46e5" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="224" fill="url(#glow)"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="208" fill="none" stroke="url(#accent)" stroke-width="14" opacity="0.55"/>
</svg>`;

const svgBuffer = readFileSync(LOGO);

// The logo is white; scale it to sit comfortably inside the canvas.
const logoPng = await sharp(svgBuffer, { density: 300 })
  .resize({ width: 780 })
  .png()
  .toBuffer();

const logoMeta = await sharp(logoPng).metadata();
const logoW = Math.min(780, logoMeta.width ?? 780);
const logoH = Math.round((logoMeta.height ?? logoW * (165 / 571)) * (logoW / (logoMeta.width ?? logoW)));
const left = Math.round((W - logoW) / 2);
const top = Math.round((H - logoH) / 2);

await sharp(Buffer.from(background))
  .composite([{ input: logoPng, left, top }])
  .png()
  .toFile(path.join(BUILD, 'icon.png'));

// Icon sizes for ico/icns generation.
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
for (const size of sizes) {
  await sharp(path.join(BUILD, 'icon.png'))
    .resize(size, size)
    .png()
    .toFile(path.join(BUILD, `icon-${size}.png`));
}

console.log('icons written to build/');
