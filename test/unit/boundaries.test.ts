import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonc } from '../../src/main/config/jsonc';

/**
 * The layers .fallowrc.jsonc draws, each crossed on purpose: a project of empty modules at the paths below, under the system's temporary folder, checked by fallow with the repo's own `boundaries` and nothing else of its config.
 * A crossing comes back as the two layers it joins, `from → to`, so a pattern that misses a spelling, or a zone that takes a file it should not, fails here instead of letting a crossing through.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));

const cases: [file: string, specifier: string, crossing: string | null][] = [
  // Each process's folder against the others.
  ['src/main/x.ts', '../renderer/state/store', 'main → state'],
  ['src/main/x.ts', '../preload/preload', 'main → preload'],
  ['src/main/x.ts', '../shared/types', null],
  ['src/preload/x.ts', '../main/config', 'preload → main'],
  ['src/preload/x.ts', '../renderer/state/store', 'preload → state'],
  ['src/shared/x.ts', '../main/config', 'shared → main'],
  ['src/shared/x.ts', '../renderer/state/store', 'shared → state'],

  // The process rule from every layer of the renderer.
  ['src/renderer/x.ts', '../main/config', 'services → main'],
  ['src/renderer/renderer.ts', '../main/config', 'start → main'],
  ['src/renderer/state/x.ts', '../../main/config', 'state → main'],
  ['src/renderer/panels/x.ts', '../../main/config', 'panels → main'],
  ['src/renderer/panels/tree.ts', '../../main/config', 'tree → main'],
  ['src/renderer/panels/types/x.ts', '../../../main/config', 'types → main'],
  ['src/renderer/panels/types/claude/x.ts', '../../../../main/config', 'claude → main'],
  ['src/renderer/panels/types/sessions/x.ts', '../../../../main/config', 'sessions → main'],

  // A service sits below the panels; the start-up does not.
  ['src/renderer/x.ts', './panels/tree', 'services → tree'],
  ['src/renderer/x.ts', './panels', 'services → panels'],
  ['src/renderer/x.ts', '../renderer/panels/tree', 'services → tree'],
  ['src/renderer/x.ts', './state/store', null],
  ['src/renderer/x.ts', '../shared/panels', null],
  ['src/renderer/renderer.ts', './panels/tree', null],
  ['src/renderer/ui/x.ts', '../panels/tree', 'services → tree'],
  ['src/renderer/dialogs/x.ts', '../panels', 'services → panels'],
  ['src/renderer/rules/x.ts', '../panels/tree', 'services → tree'],
  ['src/renderer/status/x.ts', '../state/store', null],
  ['src/renderer/ui/x.ts', '../../shared/panels', null],
  ['src/renderer/ui/x.ts', '../../main/config', 'services → main'],
  ['src/renderer/window/view-saving.ts', '../panels/tree', null],

  // So does the store.
  ['src/renderer/state/x.ts', '../panels/tree', 'state → tree'],
  ['src/renderer/state/x.ts', '../panels', 'state → panels'],
  ['src/renderer/state/x.ts', '../../shared/panels', null],

  // Only the tree places the panel types.
  ['src/renderer/panels/x.ts', './types/command', 'panels → types'],
  ['src/renderer/panels/x.ts', './types', 'panels → types'],
  ['src/renderer/panels/x.ts', './contract', null],
  ['src/renderer/panels/tree.ts', './types/sessions', null],

  // The two built-ins apart, however the other's folder is spelled.
  ['src/renderer/panels/types/claude/x.ts', '../sessions/list', 'claude → sessions'],
  ['src/renderer/panels/types/claude/x.ts', '../sessions', 'claude → sessions'],
  ['src/renderer/panels/types/claude/x.ts', '../../types/sessions/list', 'claude → sessions'],
  ['src/renderer/panels/types/claude/history/x.ts', '../../sessions/list', 'claude → sessions'],
  ['src/renderer/panels/types/claude/history/x.ts', '../../../types/sessions/list', 'claude → sessions'],
  ['src/renderer/panels/types/claude/x.ts', '../../../../renderer/panels/types/sessions/list', 'claude → sessions'],
  ['src/renderer/panels/types/claude/x.ts', '../../contract', null],
  ['src/renderer/panels/types/claude/x.ts', '../../../state/store', null],
  ['src/renderer/panels/types/claude/x.ts', '../../../state/sessions', null],
  ['src/renderer/panels/types/claude/x.ts', '../../../rules/sessions', null],
  ['src/renderer/panels/types/claude/history/x.ts', '../../../../rules/session-list', null],
  ['src/renderer/panels/types/sessions/x.ts', '../claude/asks', 'sessions → claude'],
  ['src/renderer/panels/types/sessions/x.ts', '../claude', 'sessions → claude'],
  ['src/renderer/panels/types/sessions/x.ts', '../../types/claude/asks', 'sessions → claude'],
  ['src/renderer/panels/types/sessions/x.ts', '../../contract', null],
  ['src/renderer/panels/types/sessions/x.ts', '../../../state/claude', null],
  ['src/renderer/panels/types/sessions/x.ts', '../../../rules/claude', null],
];

/** Where each case's import sits: a file of its own for the `x.ts` stand-ins, and a line each in a file the zones name. */
const files = cases.map(([file], index) => (posix.basename(file) === 'x.ts' ? posix.join(posix.dirname(file), `x${index}.ts`) : file));
const placed = files.map((file, index) => ({ file, line: files.slice(0, index).filter((earlier) => earlier === file).length + 1 }));

/** The module an import reaches: the folder's index where the repo has that folder, else a file of that name. */
function target(file: string, specifier: string): string {
  const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
  const folder = join(root, resolved);
  return existsSync(folder) && statSync(folder).isDirectory() ? `${resolved}/index.ts` : `${resolved}.ts`;
}

let project = '';
const crossings = new Map<string, string>();
let unplaced: unknown[] = [];

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'claude-ui-layers-'));
  const read = readJsonc(readFileSync(join(root, '.fallowrc.jsonc'), 'utf8'));
  if (!read.ok) throw new Error(`.fallowrc.jsonc: ${read.error}`);
  const { boundaries } = read.json as { boundaries: unknown };
  writeFileSync(join(project, 'package.json'), '{ "name": "layers", "private": true }\n');
  writeFileSync(join(project, '.fallowrc.json'), JSON.stringify({ boundaries }));
  const write = (file: string, text: string): void => {
    mkdirSync(dirname(join(project, file)), { recursive: true });
    writeFileSync(join(project, file), text);
  };
  for (const [file, specifier] of cases) write(target(file, specifier), 'export {};\n');
  const lines = new Map<string, string[]>();
  cases.forEach(([, specifier], index) => {
    const { file } = placed[index];
    lines.set(file, [...(lines.get(file) ?? []), `import '${specifier}';`]);
  });
  for (const [file, imports] of lines) write(file, `${imports.join('\n')}\n`);
  const run = spawnSync(join(root, 'node_modules/.bin/fallow'), ['architecture', '--boundaries', '--root', project, '--format', 'json'], { cwd: root, encoding: 'utf8' });
  const report = JSON.parse(run.stdout) as { boundary_violations: { from_path: string; line: number; from_zone: string; to_zone: string }[]; boundary_coverage_violations: unknown[] };
  unplaced = report.boundary_coverage_violations;
  for (const violation of report.boundary_violations) crossings.set(`${violation.from_path}:${violation.line}`, `${violation.from_zone} → ${violation.to_zone}`);
});

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe('the layers', () => {
  it('place every module the cases make', () => {
    expect(unplaced).toEqual([]);
  });

  it.each(cases.map((entry, index) => [...entry, index] as const))('%s importing %s crosses %s', (_file, _specifier, crossing, index) => {
    const { file, line } = placed[index];
    expect(crossings.get(`${file}:${line}`) ?? null).toBe(crossing);
  });
});
