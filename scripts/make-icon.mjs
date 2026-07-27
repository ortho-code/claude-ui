// Generates assets/icon.png (256x256) with no external tools: a rounded accent tile with a
// terminal chevron. Run: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 256;
const buf = Buffer.alloc(S * S * 4); // RGBA, transparent
const BG = [137, 180, 250]; // accent blue
const FG = [30, 30, 46]; // dark

function px(x, y, c) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
  buf[i + 3] = 255;
}

// Rounded-square tile.
const R = 52;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = x < R ? R : x > S - 1 - R ? S - 1 - R : x;
    const cy = y < R ? R : y > S - 1 - R ? S - 1 - R : y;
    if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) px(x, y, BG);
  }
}

// Thick line segment.
function line(x1, y1, x2, y2, th, c) {
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
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, y * S * 4 + S * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
