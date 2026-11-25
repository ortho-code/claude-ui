import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { firstWrite, textBefore } from '../../../../src/main/sessions/touched';

// Records shaped as Claude Code writes them, reduced to the fields the reading uses.
const call = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, at: string, toolUseResult: unknown, error = false) => ({
  type: 'user',
  timestamp: at,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done', ...(error ? { is_error: true } : {}) }] },
  toolUseResult,
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-touched-'));
afterAll(() => fs.rm(root, { recursive: true, force: true }));

let transcript = '';
let n = 0;
beforeEach(async () => {
  transcript = path.join(root, `session-${++n}.jsonl`);
});

const lines = (...records: unknown[]): string => records.map((record) => JSON.stringify(record)).join('\n') + '\n';
const write = (...records: unknown[]): Promise<void> => fs.writeFile(transcript, lines(...records));
const before = async (file: string): Promise<string | null | undefined> => {
  const found = await firstWrite(transcript, file);
  return found ? textBefore(found.start) : undefined;
};

describe("a file's first change by the session", () => {
  it('created by a Write, starts from nothing', async () => {
    await write(call('w', 'Write', { file_path: '/notes/a.md', content: 'new' }), result('w', '2026-11-23T08:00:00Z', { type: 'create', filePath: '/notes/a.md', content: 'new' }));
    expect((await firstWrite(transcript, '/notes/a.md'))?.start.kind).toBe('created');
    expect(await before('/notes/a.md')).toBe('');
  });

  it('an edit that kept the text it changed starts from that text, read again from its record', async () => {
    await write(
      call('r', 'Read', { file_path: '/notes/a.md' }),
      result('r', '2026-11-23T08:00:00Z', { type: 'text', file: { filePath: '/notes/a.md', content: 'read' } }),
      call('e', 'Edit', { file_path: '/notes/a.md', old_string: 'one', new_string: 'two' }),
      result('e', '2026-11-23T08:01:00Z', { filePath: '/notes/a.md', originalFile: 'one\n', structuredPatch: [] }),
    );
    expect(await before('/notes/a.md')).toBe('one\n');
  });

  it("an edit whose result kept no text is one whose start is not known", async () => {
    await write(call('e', 'Edit', { file_path: '/notes/a.md' }), result('e', '2026-11-23T08:00:00Z', { filePath: '/notes/a.md', originalFile: null, structuredPatch: [] }));
    expect((await firstWrite(transcript, '/notes/a.md'))?.start.kind).toBe('unknown');
    expect(await before('/notes/a.md')).toBeNull();
  });

  it('a call whose result was an error changed nothing, so the next one that succeeded is the first', async () => {
    await write(
      call('bad', 'Edit', { file_path: '/notes/a.md' }),
      result('bad', '2026-11-23T08:00:00Z', 'Error: blocked by a hook', true),
      call('good', 'Edit', { file_path: '/notes/a.md' }),
      result('good', '2026-11-23T08:01:00Z', { filePath: '/notes/a.md', originalFile: 'second\n', structuredPatch: [] }),
    );
    expect((await firstWrite(transcript, '/notes/a.md'))?.at).toBe('2026-11-23T08:01:00Z');
    expect(await before('/notes/a.md')).toBe('second\n');
  });

  it('a later change leaves the first one standing', async () => {
    await write(
      call('one', 'Edit', { file_path: '/notes/a.md' }),
      result('one', '2026-11-23T08:00:00Z', { filePath: '/notes/a.md', originalFile: 'first\n', structuredPatch: [] }),
      call('two', 'Edit', { file_path: '/notes/a.md' }),
      result('two', '2026-11-23T08:01:00Z', { filePath: '/notes/a.md', originalFile: 'later\n', structuredPatch: [] }),
    );
    expect(await before('/notes/a.md')).toBe('first\n');
  });

  it('a record answering two calls cannot say which its result describes, so neither start is known', async () => {
    await write(
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: '/notes/a.md' } }, { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/notes/b.md' } }] } },
      {
        type: 'user',
        timestamp: '2026-11-23T08:00:00Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'done' }, { type: 'tool_result', tool_use_id: 'b', content: 'done' }] },
        toolUseResult: { filePath: '/notes/a.md', originalFile: 'a\n', structuredPatch: [] },
      },
    );
    expect((await firstWrite(transcript, '/notes/a.md'))?.start.kind).toBe('unknown');
    expect((await firstWrite(transcript, '/notes/b.md'))?.start.kind).toBe('unknown');
  });

  it('a file only read, or named by a relative path, is no file the session changed', async () => {
    await write(
      call('r', 'Read', { file_path: '/notes/a.md' }),
      result('r', '2026-11-23T08:00:00Z', { type: 'text', file: { filePath: '/notes/a.md', content: 'x' } }),
      call('w', 'Write', { file_path: 'notes/b.md' }),
      result('w', '2026-11-23T08:01:00Z', { type: 'create', filePath: 'notes/b.md', content: 'x' }),
    );
    expect(await firstWrite(transcript, '/notes/a.md')).toBeUndefined();
    expect(await firstWrite(transcript, 'notes/b.md')).toBeUndefined();
  });

  it("a subagent's change that came first is the session's first", async () => {
    await write(call('e', 'Edit', { file_path: '/notes/a.md' }), result('e', '2026-11-23T08:05:00Z', { filePath: '/notes/a.md', originalFile: 'session\n', structuredPatch: [] }));
    const subagents = path.join(root, path.basename(transcript, '.jsonl'), 'subagents');
    await fs.mkdir(subagents, { recursive: true });
    await fs.writeFile(path.join(subagents, 'agent-1.jsonl'), lines(call('s', 'Edit', { file_path: '/notes/a.md' }), result('s', '2026-11-23T08:00:00Z', { filePath: '/notes/a.md', originalFile: 'subagent\n', structuredPatch: [] })));
    expect(await before('/notes/a.md')).toBe('subagent\n');
  });

  it('a change appended after the last ask is found by the next', async () => {
    await write(call('r', 'Read', { file_path: '/notes/a.md' }));
    expect(await firstWrite(transcript, '/notes/a.md')).toBeUndefined();
    await fs.appendFile(transcript, lines(call('w', 'Write', { file_path: '/notes/a.md' }), result('w', '2026-11-23T08:00:00Z', { type: 'create', filePath: '/notes/a.md', content: 'x' })));
    expect((await firstWrite(transcript, '/notes/a.md'))?.start.kind).toBe('created');
  });
});
