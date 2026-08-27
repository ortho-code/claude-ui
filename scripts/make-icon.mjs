// Generates assets/icon.png with no external tools: a rounded accent tile with a terminal chevron.
// Run: node scripts/make-icon.mjs
//
// 1024x1024, because macOS icns wants that size and electron-builder rasterises to 1024 before
// converting — a smaller source is upscaled and goes soft. Every coordinate below is written in the
// original 256-unit design space and scaled by K, so SIZE is the only knob.
//
// Drawing is supersampled SS times and box-filtered down. The shapes are decided by a binary
// inside/outside test, which at 1024 would leave visibly jagged edges on the tile's corners and the
// chevron's diagonals; averaging sub-samples gives them a clean edge instead.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SS = 3;
const K = (SIZE * SS) / 256; // design units -> supersampled pixels
const N = SIZE * SS;

const buf = Buffer.alloc(N * N * 4); // RGBA, transparent
const BG = [137, 180, 250]; // accent blue
const FG = [30, 30, 46]; // dark

function px(x, y, c) {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
  buf[i + 3] = 255;
}

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
function line(x1, y1, x2, y2, th, c) {
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
}

// Chevron ">" and a cursor underscore.
line(98, 76, 172, 128, 15, FG);
line(172, 128, 98, 180, 15, FG);
line(150, 192, 196, 192, 15, FG);

// Box-filter SSxSS blocks down to one pixel. RGB is averaged weighted by alpha (premultiplied) so
// the transparent pixels outside the tile, whose RGB is 0, do not darken its edge into a black rim.
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
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
    const o = (y * SIZE + x) * 4;
    if (a > 0) {
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
    }
    out[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
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

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, y * SIZE * 4 + SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png);
console.log('wrote', target, `${SIZE}x${SIZE}`, png.length, 'bytes');
