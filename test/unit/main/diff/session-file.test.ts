import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', async () => (await import('../sessions/sessions-home')).electronStub);
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()),
  ...(await import('../sessions/sessions-home')).logStub,
}));
vi.mock('node:os', async () => (await import('../sessions/sessions-home')).osStub);

const { sessionFileDiff } = await import('../../../../src/main/diff/session-file');
const { jsonl, projectsDir, testHome } = await import('../sessions/sessions-home');

// A session's transcript in the test home, changing files in a folder no repository holds.
const notes = path.join(testHome, 'notes');
const file = (name: string): string => path.join(notes, name);
const call = (id: string, name: string, filePath: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { file_path: filePath } }] } });
const result = (id: string, toolUseResult: unknown) => ({ type: 'user', timestamp: '2026-11-23T08:00:00Z', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] }, toolUseResult });

beforeAll(async () => {
  await fs.mkdir(notes, { recursive: true });
  await fs.writeFile(file('created.md'), 'one\ntwo\n');
  await fs.writeFile(file('edited.md'), 'one\nthree\n');
  await fs.writeFile(file('unknown.md'), 'as it is\n');
  await fs.writeFile(file('read.md'), 'only read\n');
  await fs.writeFile(file('reverted.md'), 'as before\n');
  await fs.writeFile(file('spaced.md'), '  indented\n');
  await fs.writeFile(file('run.sh'), 'echo hi\n', { mode: 0o755 });
  const dir = path.join(projectsDir, '-notes');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'session-a.jsonl'),
    jsonl(
      call('c', 'Write', file('created.md')),
      result('c', { type: 'create', filePath: file('created.md'), content: 'one\n' }),
      call('e', 'Edit', file('edited.md')),
      result('e', { filePath: file('edited.md'), originalFile: 'one\ntwo\n', structuredPatch: [] }),
      call('u', 'Edit', file('unknown.md')),
      result('u', { filePath: file('unknown.md'), originalFile: null, structuredPatch: [] }),
      call('r', 'Read', file('read.md')),
      result('r', { type: 'text', file: { filePath: file('read.md'), content: 'only read\n' } }),
      call('v', 'Edit', file('reverted.md')),
      result('v', { filePath: file('reverted.md'), originalFile: 'as before\n', structuredPatch: [] }),
      call('s', 'Edit', file('spaced.md')),
      result('s', { filePath: file('spaced.md'), originalFile: 'indented\n', structuredPatch: [] }),
      call('x', 'Edit', file('run.sh')),
      result('x', { filePath: file('run.sh'), originalFile: 'echo ho\n', structuredPatch: [] }),
    ),
  );
});

afterAll(() => fs.rm(notes, { recursive: true, force: true }));

/** A diff's rows as a unified diff writes them. */
const rows = (diff: { hunks: { rows: { kind: string; text: string }[] }[] }): string[] => diff.hunks.flatMap((hunk) => hunk.rows.map((row) => `${{ add: '+', del: '-', context: ' ' }[row.kind]}${row.text}`));

describe("a file's changes since the session first changed it", () => {
  it('a file the session created is all added, up to the file as it is now', async () => {
    const diff = await sessionFileDiff('session-a', file('created.md'), 3, false);
    expect(diff.start).toBe('created');
    expect(rows(diff)).toEqual(['+one', '+two']);
    expect(diff.lines).toEqual(['one', 'two']);
  });

  it('an edited file is compared with the text it had before the first edit', async () => {
    const diff = await sessionFileDiff('session-a', file('edited.md'), 3, false);
    expect(diff.start).toBe('recorded');
    expect(rows(diff)).toEqual([' one', '-two', '+three']);
  });

  it('a file whose text from then is not recorded, or that was only read, has no changes, the file as it is now', async () => {
    const unknown = await sessionFileDiff('session-a', file('unknown.md'), 3, false);
    expect([unknown.start, unknown.hunks, unknown.lines]).toEqual(['unknown', [], ['as it is']]);
    const read = await sessionFileDiff('session-a', file('read.md'), 3, false);
    expect([read.start, read.hunks, read.lines]).toEqual(['unwritten', [], ['only read']]);
  });

  it('a file put back to the text it had then is identical to it, and one changed only in whitespace is not, though it has no hunks with whitespace left out', async () => {
    const reverted = await sessionFileDiff('session-a', file('reverted.md'), 3, true);
    const spaced = await sessionFileDiff('session-a', file('spaced.md'), 3, true);
    expect([reverted.hunks, reverted.identical]).toEqual([[], true]);
    expect([spaced.hunks, spaced.identical]).toEqual([[], false]);
  });

  it('a changed file is not identical to its text from then, nor is one with nothing to compare with', async () => {
    const changes = await Promise.all(['created.md', 'edited.md', 'unknown.md', 'read.md'].map((name) => sessionFileDiff('session-a', file(name), 3, false)));
    expect(changes.map((diff) => diff.identical)).toEqual([false, false, false, false]);
  });

  it('says no change of mode, since the text from then has none recorded', async () => {
    const diff = await sessionFileDiff('session-a', file('run.sh'), 3, false);
    expect(rows(diff)).toEqual(['-echo ho', '+echo hi']);
    expect(diff.mode).toBeNull();
  });

  it('a file no longer on disk says so, with no changes, whether the session created it, edited it or only read it', async () => {
    const before = await Promise.all(['created.md', 'edited.md', 'read.md'].map((name) => sessionFileDiff('session-a', file(name), 3, false)));
    expect(before.map((diff) => diff.gone)).toEqual([false, false, false]);
    for (const name of ['created.md', 'edited.md', 'read.md']) await fs.rm(file(name));
    const after = await Promise.all(['created.md', 'edited.md', 'read.md'].map((name) => sessionFileDiff('session-a', file(name), 3, false)));
    expect(after.map((diff) => [diff.gone, diff.hunks, diff.lines])).toEqual([
      [true, [], null],
      [true, [], null],
      [true, [], null],
    ]);
  });
});
