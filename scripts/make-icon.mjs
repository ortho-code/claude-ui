// Generates the app icons with no external tools: a rounded accent tile with a terminal chevron.
// Run: node scripts/make-icon.mjs
//
// Writes TWO things, because the platforms need different shapes:
//   assets/icon.png   — 1024x1024, for macOS and for the BrowserWindow icon. electron-builder
//                       rasterises to 1024 before building the .icns, so a smaller source goes soft,
//                       and it derives every icns size from this one file.
//   assets/icons/     — one PNG per size, which is what Linux needs. electron-builder installs only
//                       the hicolor sizes it is GIVEN: a single 1024px source produced exactly
//                       /usr/share/icons/hicolor/1024x1024/apps/claude-ui.png, and desktop
//                       environments looking for 16 through 256 found nothing and fell back to the
//                       distro's own icon. macOS was unaffected, which is why this looked
//                       Linux-specific. `linux.icon` points at this directory.
//
// Every coordinate is written in the original 256-unit design space and scaled by K, so each size
// renders the design at its own resolution rather than resampling another size.
//
// Drawing is supersampled SS times and box-filtered down. The shapes come from a binary
// inside/outside test, which alone leaves visibly jagged tile corners and chevron diagonals;
// averaging sub-samples gives them a clean edge.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SS = 3;
const BG = [137, 180, 250]; // accent blue
const FG = [30, 30, 46]; // dark

// The hicolor sizes desktop environments actually look for, plus 1024 for macOS.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function render(size) {
  const K = (size * SS) / 256; // design units -> supersampled pixels
  const N = size * SS;
  const buf = Buffer.alloc(N * N * 4); // RGBA, transparent

  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = 255;
  };

  // Rounded-square tile.
  const R = 52 * K;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = x < R ? R : x > N - 1 - R ? N - 1 - R : x;
      const cy = y < R ? R : y > N - 1 - R ? N - 1 - R : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) px(x, y, BG);
    }
  }

  // Thick line segment, in design units.
  const line = (x1, y1, x2, y2, th, c) => {
    [x1, y1, x2, y2, th] = [x1 * K, y1 * K, x2 * K, y2 * K, th * K];
    for (let y = Math.floor(Math.min(y1, y2) - th); y <= Math.ceil(Math.max(y1, y2) + th); y++) {
      for (let x = Math.floor(Math.min(x1, x2) - th); x <= Math.ceil(Math.max(x1, x2) + th); x++) {
        const vx = x2 - x1;
        const vy = y2 - y1;
        let t = ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy);
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) <= th) px(x, y, c);
      }
    }
  };

  // Chevron ">" and a cursor underscore.
  line(98, 76, 172, 128, 15, FG);
  line(172, 128, 98, 180, 15, FG);
  line(150, 192, 196, 192, 15, FG);

  // Box-filter SSxSS blocks down to one pixel. RGB is averaged weighted by alpha (premultiplied) so
  // the transparent pixels outside the tile, whose RGB is 0, do not darken its edge into a black rim.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          const alpha = buf[i + 3] / 255;
          r += buf[i] * alpha;
          g += buf[i + 1] * alpha;
          b += buf[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return toPng(out, size);
}

function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, y * size * 4 + size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const iconDir = join(assets, 'icons');
mkdirSync(iconDir, { recursive: true });

for (const size of SIZES) {
  const png = render(size);
  // electron-builder reads a linux icon directory by exactly these filenames.
  writeFileSync(join(iconDir, `${size}x${size}.png`), png);
  if (size === 1024) writeFileSync(join(assets, 'icon.png'), png);
  console.log(`wrote ${size}x${size}.png`, png.length, 'bytes');
}
