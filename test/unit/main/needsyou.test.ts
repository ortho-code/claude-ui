import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));

// The app's path is the repository's when it runs from source, which is where the bundled files are read from.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => tmpdir(), setPath: () => {} } }));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { readBundledNeedsYou, readNeedsYou } from '../../../src/main/needsyou';

beforeEach(() => {
  logged.length = 0;
});

describe('the bundled needs-you categories and types', () => {
  it('every bundled file reads without a mistake, as the six categories and eleven types decided (design decisions 85 to 87)', async () => {
    const registry = await readBundledNeedsYou();
    expect(logged).toEqual([]);
    expect(registry.categories.map((c) => [c.id, c.label, c.enabled])).toEqual([
      ['your-turn', 'Your turn', true],
      ['back-to-work', 'Back to work', true],
      ['ready-to-merge', 'Ready to merge', true],
      ['look-again', 'Look again', true],
      ['reminders', 'Reminders', true],
      ['finish-up', 'Finish up', true],
    ]);
    expect(Object.fromEntries(registry.types.map((t) => [t.id, t.category]))).toEqual({
      'app.reminder': 'reminders',
      'app.was-running': 'reminders',
      'claude.asks': 'your-turn',
      'claude.finished': 'your-turn',
      'pr.approved': 'ready-to-merge',
      'pr.changes-requested': 'back-to-work',
      'pr.checks-failed': 'back-to-work',
      'pr.closed': 'finish-up',
      'pr.conflict': 'back-to-work',
      'pr.merged': 'finish-up',
      'pr.reopened': 'look-again',
    });
    expect(registry.types.every((t) => t.enabled)).toBe(true);
  });

  it('logs a file that does not parse or has a mistake, and keeps the rest', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'claude-ui-needs-you-'));
    writeFileSync(path.join(dir, 'c.jsonc'), '{ "kind": "category", "id": "c", "label": "C", "order": 1 }');
    writeFileSync(path.join(dir, 'broken.jsonc'), '{ "kind": ');
    writeFileSync(path.join(dir, 'wrong.jsonc'), '{ "kind": "type", "id": "w", "label": "W", "category": "nowhere" }');
    writeFileSync(path.join(dir, 'notes.txt'), 'not read');
    const registry = await readBundledNeedsYou(dir);
    expect(registry).toEqual({ categories: [{ id: 'c', label: 'C', order: 1, enabled: true }], types: [] });
    expect(logged).toEqual(['error needs-you broken.jsonc: expected a value at the end of the file', 'error needs-you wrong.jsonc: no category has the id "nowhere"']);
  });

  it('logs a folder it cannot list, and has nothing', async () => {
    expect(await readBundledNeedsYou(path.join(tmpdir(), 'claude-ui-no-such-folder'))).toEqual({ categories: [], types: [] });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^error needs-you could not list the bundled categories and types: ENOENT/);
  });
});

describe('your changes to them, in needs-you/', () => {
  it('apply each .json file by id, and with no folder there change nothing and say nothing', async () => {
    const bundled = await readBundledNeedsYou();
    expect(await readNeedsYou(bundled, path.join(tmpdir(), 'claude-ui-no-such-folder'))).toEqual({ registry: bundled, problems: [] });
    const dir = mkdtempSync(path.join(tmpdir(), 'claude-ui-needs-you-yours-'));
    writeFileSync(path.join(dir, 'approved.json'), '// Approvals are noise here.\n{ "id": "pr.approved", "enabled": false }');
    writeFileSync(path.join(dir, 'notes.txt'), '{ "id": "pr.merged", "enabled": false }');
    const read = await readNeedsYou(bundled, dir);
    expect(read.problems).toEqual([]);
    expect(read.registry.types.filter((t) => !t.enabled).map((t) => t.id)).toEqual(['pr.approved']);
  });

  it('name a file of yours that does not parse or has a mistake, with the folder, and use the others', async () => {
    const bundled = await readBundledNeedsYou();
    const dir = mkdtempSync(path.join(tmpdir(), 'claude-ui-needs-you-yours-'));
    writeFileSync(path.join(dir, 'a.json'), '{ "id": ');
    writeFileSync(path.join(dir, 'b.json'), '{ "id": "app.nope", "enabled": false }');
    writeFileSync(path.join(dir, 'c.json'), '{ "id": "app.reminder", "enabled": false }');
    const read = await readNeedsYou(bundled, dir);
    expect(read.problems).toEqual(['needs-you/a.json: expected a value at the end of the file', 'needs-you/b.json: nothing the app ships has the id "app.nope"']);
    expect(read.registry.types.filter((t) => !t.enabled).map((t) => t.id)).toEqual(['app.reminder']);
    expect(logged.filter((line) => line.startsWith('warn needs-you'))).toHaveLength(2);
  });

  // As the layout and the settings are (docs/principles.md § Failures show).
  it('keep a file that stops parsing in force as it last read, naming it, and drop a file that is gone', async () => {
    const bundled = await readBundledNeedsYou();
    const dir = mkdtempSync(path.join(tmpdir(), 'claude-ui-needs-you-yours-'));
    const file = path.join(dir, 'reminder.json');
    writeFileSync(file, '{ "id": "app.reminder", "enabled": false }');
    expect((await readNeedsYou(bundled, dir)).problems).toEqual([]);
    writeFileSync(file, '{ "id": "app.reminder", "enabled": fals');
    const broken = await readNeedsYou(bundled, dir);
    expect(broken.problems).toHaveLength(1);
    expect(broken.problems[0]).toMatch(/^needs-you\/reminder\.json: .*; it is used as it last read$/);
    expect(broken.registry.types.find((t) => t.id === 'app.reminder')?.enabled).toBe(false);
    rmSync(file);
    expect((await readNeedsYou(bundled, dir)).registry).toEqual(bundled);
  });
});
