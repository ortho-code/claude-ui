import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Exchange } from '../shared/types';
import { foldRecord, newFold, readHistory, type HistoryFold } from './transcript';

// Records shaped as Claude Code writes them, reduced to the fields the fold reads.
let n = 0;
const uuid = (): string => `u${++n}`;
const typed = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'user', uuid: uuid(), timestamp: '2026-09-29T10:00:00Z', message: { content: text }, ...extra });
const userList = (content: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'user', uuid: uuid(), timestamp: '2026-09-29T10:00:00Z', message: { content }, ...extra });
const toolResult = () => userList([{ type: 'tool_result', tool_use_id: 't', content: 'output' }]);
const answer = (...parts: unknown[]) => ({ type: 'assistant', uuid: uuid(), timestamp: '2026-09-29T10:00:30Z', message: { content: parts } });
const text = (t: string) => ({ type: 'text', text: t });
const tool = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', name, input });
const command = (name: string, args = '') => typed(`<command-message>${name.slice(1)}</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`);
const queued = (prompt: string) => ({ type: 'attachment', uuid: uuid(), timestamp: '2026-09-29T10:01:00Z', attachment: { type: 'queued_command', prompt, source_uuid: 'not-a-record' } });

function fold(...records: Record<string, unknown>[]): HistoryFold {
  const f = newFold();
  for (const r of records) foldRecord(f, r);
  return f;
}
const requests = (f: HistoryFold) => f.exchanges.map((e) => `${e.kind}: ${e.request}`);
const replyText = (e: Exchange) => e.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n\n');
const toolLines = (e: Exchange) => e.parts.flatMap((p) => (p.kind === 'tool' ? [p.detail ? `${p.name}(${p.detail})` : p.name] : []));

describe('what counts as a request', () => {
  it('a typed prompt, with its reply: each message its own part, the tool calls where they came', () => {
    const q = typed('why does the sniff not fire?');
    const first = answer(text('Let me look.'), tool('Read', { file_path: '/repo/src/Sniff.php' }));
    const second = answer(text('Found it.'));
    const f = fold(q, first, toolResult(), second);
    expect(f.exchanges).toEqual([
      {
        id: q.uuid,
        time: q.timestamp,
        request: 'why does the sniff not fire?',
        kind: 'typed',
        replaced: false,
        parts: [
          { kind: 'text', id: `${first.uuid}:0`, time: first.timestamp, text: 'Let me look.' },
          { kind: 'tool', name: 'Read', detail: '/repo/src/Sniff.php' },
          { kind: 'text', id: `${second.uuid}:0`, time: second.timestamp, text: 'Found it.' },
        ],
      },
    ]);
  });

  it('gives each message of one record its own id, by its place among them', () => {
    const a = answer(text('One.'), tool('Bash', { command: 'ls' }), text('Two.'));
    const f = fold(typed('go'), a);
    expect(f.exchanges[0].parts.flatMap((p) => (p.kind === 'text' ? [p.id] : []))).toEqual([`${a.uuid}:0`, `${a.uuid}:1`]);
  });

  it('a prompt with a pasted image, by its text', () => {
    expect(requests(fold(userList([{ type: 'image', source: {} }, text('why so many changes?')])))).toEqual(['typed: why so many changes?']);
  });

  it('a prompt sent while a tool ran is marked busy', () => {
    const f = fold(typed('run the suite'), answer(tool('Bash', { command: 'vendor/bin/phpunit' })), userList([{ type: 'tool_result', content: '' }, text('and add it to pre-commit?')]));
    expect(requests(f)).toEqual(['typed: run the suite', 'busy: and add it to pre-commit?']);
  });

  it('a prompt queued while claude worked is a request, keyed by its own record uuid', () => {
    const q = queued("isn't revisionId always 1?");
    const f = fold(typed('fix it'), answer(text('Working.')), q);
    expect(requests(f)).toEqual(['typed: fix it', "busy: isn't revisionId always 1?"]);
    expect(f.exchanges[1].id).toBe(q.uuid);
  });

  it('a user record the CLI marks as queued is busy too', () => {
    expect(requests(fold(typed('and this', { promptSource: 'queued' })))).toEqual(['busy: and this']);
  });

  it('a slash command claude answers is a request, as its command line', () => {
    const f = fold(command('/review', 'https://github.com/o/r/pull/1'), userList([text('Base directory for this skill: …')], { isMeta: true }), answer(text('The review.')));
    expect(requests(f)).toEqual(['command: /review https://github.com/o/r/pull/1']);
    expect(replyText(f.exchanges[0])).toBe('The review.');
  });

  it('a slash command claude does not answer is dropped when the user sends something else', () => {
    const f = fold(command('/model', 'opus'), typed('<local-command-stdout>Set model to Opus</local-command-stdout>'), typed('hello'), answer(text('Hi.')));
    expect(requests(f)).toEqual(['typed: hello']);
  });

  it('a slash command waiting at the end of one read becomes a request when the next read brings its answer', () => {
    const f = fold(command('/learn'));
    expect(f.exchanges).toEqual([]);
    foldRecord(f, answer(text('Learned.')));
    expect(requests(f)).toEqual(['command: /learn']);
  });

  it.each([
    ['a tool result', toolResult()],
    ['a meta record', typed('Another Claude session sent a message', { isMeta: true })],
    ['a compaction summary', typed('This session is being continued from a previous conversation', { isCompactSummary: true })],
    ['an interruption', userList([text('[Request interrupted by user]')])],
    ['a task notification', typed('<task-notification> <task-id>x</task-id>')],
    ['a local command caveat', typed('<local-command-caveat>Caveat: …</local-command-caveat>')],
    ['bash mode', typed('<bash-input>ls</bash-input>')],
    ['a sidechain record', typed('from a subagent', { isSidechain: true })],
  ])('%s is not a request', (_name, record) => {
    expect(fold(record).exchanges).toEqual([]);
  });

  it('claude text before the first request answers nothing and is dropped', () => {
    expect(fold(answer(text('Hello.')), typed('first')).exchanges[0].parts).toEqual([]);
  });

  it('an interruption keeps the reply written so far on its request', () => {
    const f = fold(typed('long job'), answer(text('Starting.')), userList([text('[Request interrupted by user]')]));
    expect(f.exchanges.map(replyText)).toEqual(['Starting.']);
  });
});

describe('a record written twice', () => {
  it('is read once: after a compaction Claude Code writes the conversation again under the same uuids', () => {
    const q = typed('fix the build');
    const a = answer(text('Fixed.'));
    const boundary = { type: 'system', subtype: 'compact_boundary', uuid: uuid(), parentUuid: null };
    const summary = typed('This session is being continued from a previous conversation', { isCompactSummary: true });
    const f = fold(q, a, boundary, summary, { ...q, gitBranch: 'main' }, { ...a, version: '2' }, typed('next'));
    expect(requests(f)).toEqual(['typed: fix the build', 'typed: next']);
    expect(f.exchanges.map(replyText)).toEqual(['Fixed.', '']);
  });
});

describe('a request sent again', () => {
  const replaced = (f: HistoryFold) => f.exchanges.map((e) => `${e.request}${e.replaced ? ' (replaced)' : ''}`);

  it('stopping claude and sending again marks the first attempt replaced', () => {
    const f = fold(typed('hello', { parentUuid: 'p' }), userList([text('[Request interrupted by user]')]), typed('hello', { parentUuid: 'p' }), answer(text('Hi.')));
    expect(replaced(f)).toEqual(['hello (replaced)', 'hello']);
  });

  it('an edited resend replaces it too', () => {
    const f = fold(typed("what's next?", { parentUuid: 'p' }), typed("what's next? give me a complete list", { parentUuid: 'p' }));
    expect(replaced(f)).toEqual(["what's next? (replaced)", "what's next? give me a complete list"]);
  });

  it('a request that follows on from the one before replaces nothing', () => {
    const first = typed('one', { parentUuid: 'root' });
    const f = fold(first, answer(text('A.')), typed('two', { parentUuid: 'a1' }));
    expect(replaced(f)).toEqual(['one', 'two']);
  });

  it('a request replaced from further on is left unmarked', () => {
    const f = fold(typed('one', { parentUuid: 'p' }), typed('two', { parentUuid: 'q' }), typed('three', { parentUuid: 'p' }));
    expect(replaced(f)).toEqual(['one', 'two', 'three']);
  });

  it('a request with no parent replaces nothing', () => {
    expect(replaced(fold(typed('one'), typed('two')))).toEqual(['one', 'two']);
  });

  it('a slash command claude answers can replace the attempt before it', () => {
    const f = fold(command('/review', 'x'), typed('<local-command-stdout>…</local-command-stdout>'));
    foldRecord(f, typed('first try', { parentUuid: 'p' }));
    foldRecord(f, { ...command('/review', 'y'), parentUuid: 'p' });
    foldRecord(f, answer(text('Review.')));
    expect(replaced(f)).toEqual(['first try (replaced)', '/review y']);
  });
});

describe('tool lines', () => {
  it('names the tool and the one input that says what it acted on, on one line, cut long', () => {
    const f = fold(typed('go'), answer(tool('Bash', { command: 'git status\ngit diff' }), tool('Grep', { pattern: 'enum ' }), tool('TodoWrite', { todos: [] }), tool('Bash', { command: 'x'.repeat(200) })));
    expect(toolLines(f.exchanges[0]).slice(0, 3)).toEqual(['Bash(git status)', 'Grep(enum )', 'TodoWrite']);
    expect(toolLines(f.exchanges[0])[3]).toHaveLength('Bash()'.length + 120);
  });
});

describe('reading a transcript', () => {
  let dir = '';
  const file = async (name: string) => {
    if (!dir) dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-history-'));
    return path.join(dir, name);
  };
  const line = (record: unknown) => `${JSON.stringify(record)}\n`;
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads the whole file first, then only what was appended, sending the last exchange again', async () => {
    const f = await file('grow.jsonl');
    await fs.writeFile(f, line(typed('one')) + line(answer(text('A.'))) + line(typed('two')));
    const first = await readHistory(f, 0, 0);
    expect(first.from).toBe(0);
    expect(first.exchanges.map((e) => e.request)).toEqual(['one', 'two']);

    await fs.appendFile(f, line(answer(text('B.'))) + line(typed('three')));
    const next = await readHistory(f, first.total, first.generation);
    expect(next.generation).toBe(first.generation);
    expect(next.from).toBe(1);
    expect(next.exchanges.map((e) => [e.request, replyText(e)])).toEqual([['two', 'B.'], ['three', '']]);
    expect(next.total).toBe(3);
  });

  it('marks the last exchange it sent replaced when the next read brings its replacement', async () => {
    const f = await file('resend.jsonl');
    await fs.writeFile(f, line(typed('hello', { parentUuid: 'p' })));
    const first = await readHistory(f, 0, 0);
    expect(first.exchanges[0].replaced).toBe(false);
    await fs.appendFile(f, line(typed('hello', { parentUuid: 'p' })));
    const next = await readHistory(f, first.total, first.generation);
    expect(next.from).toBe(0);
    expect(next.exchanges.map((e) => e.replaced)).toEqual([true, false]);
  });

  it('holds a line claude has not finished writing until its newline arrives', async () => {
    const f = await file('partial.jsonl');
    const whole = line(typed('complete me'));
    await fs.writeFile(f, whole.slice(0, 20));
    expect((await readHistory(f, 0, 0)).total).toBe(0);
    await fs.appendFile(f, whole.slice(20));
    const read = await readHistory(f, 0, 0);
    expect(read.exchanges.map((e) => e.request)).toEqual(['complete me']);
  });

  it('keeps a multi-byte character whole when a read ends inside it', async () => {
    const f = await file('utf8.jsonl');
    await fs.writeFile(f, line(typed('café — naïve ✓ 日本')) + line(typed('after')));
    // Three bytes a read: every non-ASCII character above is cut somewhere.
    const read = await readHistory(f, 0, 0, 3);
    expect(read.exchanges.map((e) => e.request)).toEqual(['café — naïve ✓ 日本', 'after']);
  });

  it('reads a file that shrank again from the start, as a new generation', async () => {
    const f = await file('shrink.jsonl');
    await fs.writeFile(f, line(typed('old one')) + line(typed('old two')));
    const first = await readHistory(f, 0, 0);
    await fs.writeFile(f, line(typed('new')));
    const again = await readHistory(f, first.total, first.generation);
    expect(again.generation).not.toBe(first.generation);
    expect(again.from).toBe(0);
    expect(again.exchanges.map((e) => e.request)).toEqual(['new']);
  });

  it('two reads at once fold the appended bytes once', async () => {
    const f = await file('twice.jsonl');
    await fs.writeFile(f, line(typed('a')));
    const first = await readHistory(f, 0, 0);
    await fs.appendFile(f, line(typed('b')));
    const [x, y] = await Promise.all([readHistory(f, first.total, first.generation), readHistory(f, first.total, first.generation)]);
    expect(x.total).toBe(2);
    expect(y.total).toBe(2);
  });

  it('hands back an empty history for a file that is not there', async () => {
    const read = await readHistory(await file('missing.jsonl'), 0, 0);
    expect(read.total).toBe(0);
    expect(read.exchanges).toEqual([]);
  });
});
