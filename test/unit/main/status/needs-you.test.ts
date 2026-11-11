import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));

// The app's path is the repository's when it runs from source, which is where the bundled files are read from.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => tmpdir(), setPath: () => {} } }));
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { readBundledNeedsYou } from '../../../../src/main/status/needs-you';

beforeEach(() => {
  logged.length = 0;
});

describe('the bundled needs-you categories and types', () => {
  it('every bundled file reads without a mistake, as the six categories and thirteen types decided (design decisions 85 to 87 and 109)', async () => {
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
      'claude.ready': 'your-turn',
      'pr.approved': 'ready-to-merge',
      'pr.changes-requested': 'back-to-work',
      'pr.checks-failed': 'back-to-work',
      'pr.closed': 'finish-up',
      'pr.conflict': 'back-to-work',
      'pr.merged': 'finish-up',
      'pr.new-commits': 'look-again',
      'pr.reopened': 'look-again',
      'pr.review-requested': 'look-again',
    });
    expect(registry.types.every((t) => t.enabled)).toBe(true);
  });

  it('fires the PR types that ask the author to act only for your own PRs, those about your review for a PR you review, and the rest for every role (design decision 110)', async () => {
    const registry = await readBundledNeedsYou();
    expect(Object.fromEntries(registry.types.filter((t) => t.id.startsWith('pr.')).map((t) => [t.id, t.roles]))).toEqual({
      'pr.approved': ['own'],
      'pr.changes-requested': ['own'],
      'pr.checks-failed': ['own'],
      'pr.closed': ['own', 'reviewing', 'other'],
      'pr.conflict': ['own'],
      'pr.merged': ['own', 'reviewing', 'other'],
      'pr.new-commits': ['reviewing'],
      'pr.reopened': ['own', 'reviewing', 'other'],
      'pr.review-requested': ['reviewing'],
    });
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
