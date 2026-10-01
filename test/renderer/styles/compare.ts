/**
 * Compare two style captures (snapshot.spec.ts), and say what differs: `node test/renderer/styles/compare.ts <before> <after> [renames.json]`.
 *
 * The text of each state is compared as sorted lines, so an element built in another place that looks the same changes nothing; each line only in one capture is printed, `-` for before and `+` for after.
 * A rename map, `{ "old-class": "new-class" }`, rewrites the before-capture's element keys first, keys only and never values, so a pure rename compares empty: a value of several space-separated names gives a class more than one, and an empty one takes it away.
 * The pictures are compared pixel by pixel, and every pixel that differs is listed, none excused: two captures of one build have been seen to differ by two pixels of `busy.png` (x 122, y 38-39, a shade apart: the Settings button's corner at a fractional position, which Chromium anti-aliases one shade apart between runs; docs/architecture.md § The window's checks), and that shows here as itself, to be judged rather than hidden.
 * Exits non-zero when anything differs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

interface Picture {
  width: number;
  height: number;
  data: Buffer;
}

// Playwright's own PNG reader, from the copy `@playwright/test` brings: the repo has no image library of its own, and needs none for this.
const require = createRequire(import.meta.url);
const core = path.dirname(require.resolve('playwright-core/package.json', { paths: [path.dirname(require.resolve('@playwright/test/package.json'))] }));
const { PNG } = require(path.join(core, 'lib/utilsBundle')) as { PNG: { sync: { read: (buffer: Buffer) => Picture } } };

/** How many differing pixels a picture lists before it only counts them. */
const SHOWN_PIXELS = 50;

/** An element key with its classes renamed by `renames` and sorted again, as the capture sorts them; everything after a line's ` | ` is its value and is left alone. */
function renamed(line: string, renames: ReadonlyMap<string, string[]>): string {
  const at = line.indexOf(' | ');
  const key = at < 0 ? line : line.slice(0, at);
  const rewritten = key.replace(/(?:\.[\w-]+)+/g, (classes) =>
    classes
      .slice(1)
      .split('.')
      .flatMap((name) => renames.get(name) ?? [name])
      .sort()
      .map((name) => `.${name}`)
      .join(''),
  );
  return at < 0 ? rewritten : rewritten + line.slice(at);
}

/** The lines only in `a`, as many times as `a` has them more than `b` does. */
function onlyIn(a: string[], b: string[]): string[] {
  const left = new Map<string, number>();
  for (const line of b) left.set(line, (left.get(line) ?? 0) + 1);
  return a.filter((line) => {
    const n = left.get(line) ?? 0;
    if (n === 0) return true;
    left.set(line, n - 1);
    return false;
  });
}

function compareText(before: string, after: string, renames: ReadonlyMap<string, string[]>): string[] {
  const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');
  const a = lines(before).map((line) => renamed(line, renames));
  const b = lines(after);
  return [...onlyIn(a, b).map((line) => `- ${line}`), ...onlyIn(b, a).map((line) => `+ ${line}`)].sort((x, y) => x.slice(2).localeCompare(y.slice(2)));
}

function comparePicture(before: Buffer, after: Buffer): string[] {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return [`size ${a.width}x${a.height} -> ${b.width}x${b.height}`];
  const differ: string[] = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const was = [...a.data.subarray(i, i + 4)];
      const now = [...b.data.subarray(i, i + 4)];
      if (was.some((value, channel) => value !== now[channel])) differ.push(`x ${x} y ${y}: ${was.join(',')} -> ${now.join(',')}`);
    }
  }
  if (differ.length === 0) return [];
  const more = differ.length - SHOWN_PIXELS;
  return [`${differ.length} pixels differ`, ...differ.slice(0, SHOWN_PIXELS), ...(more > 0 ? [`and ${more} more`] : [])];
}

const [beforeDir, afterDir, renamesFile] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error('Usage: node test/renderer/styles/compare.ts <before> <after> [renames.json]');
  process.exit(2);
}
const renames = new Map(
  Object.entries(renamesFile ? (JSON.parse(readFileSync(renamesFile, 'utf8')) as Record<string, string>) : {}).map(([from, to]) => [from, to.split(' ').filter((name) => name !== '')]),
);

let differs = false;
const names = [...new Set([...readdirSync(beforeDir), ...readdirSync(afterDir)])].sort();
for (const name of names) {
  const read = (dir: string): Buffer | null => (readdirSync(dir).includes(name) ? readFileSync(path.join(dir, name)) : null);
  const before = read(beforeDir);
  const after = read(afterDir);
  let report: string[];
  if (!before || !after) report = [before ? 'only before' : 'only after'];
  else if (name.endsWith('.png')) report = comparePicture(before, after);
  else report = compareText(before.toString('utf8'), after.toString('utf8'), renames);
  if (report.length === 0) continue;
  differs = true;
  console.log(`--- ${name}`);
  for (const line of report) console.log(line);
}
if (!differs) console.log('The two captures are the same.');
process.exit(differs ? 1 : 0);
