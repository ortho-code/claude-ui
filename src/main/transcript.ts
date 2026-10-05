/**
 * Reading the records of a session transcript (`~/.claude/projects/<dir>/<id>.jsonl`, one JSON record per line).
 * What a record says is decided here once, for every reader of the transcript: the session list's summary, and the history of a session's requests.
 */

import { promises as fs } from 'node:fs';
import { readFrom } from '../shared/history';
import type { Exchange, HistorySlice, ReplyPart } from '../shared/types';
import { fsFailure, logOnce } from './log';

/**
 * A message that is pure local-command plumbing — the `<local-command-caveat>` preamble a session gets when it starts with local commands, or captured `<local-command-stdout>` output — is not a usable first message; blank it so the latch waits for the first real prompt instead.
 */
export function displayableUserText(text: string): string {
  return /^<local-command-(caveat|stdout)>/.test(text.trim()) ? '' : text;
}

/**
 * A session started by a slash command wraps its first message in tags — `<command-message>word</command-message>\n<command-name>/cmd</command-name>` plus an optional (possibly empty) `<command-args>…</command-args>` — which reads as junk in the row.
 * Render it as the command line the user effectively typed: "/cmd args".
 * Anything else passes through untouched.
 */
export function commandLabel(text: string): string {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1]!.trim();
  if (!name) return text;
  const args = text.match(/<command-args>([^<]*)<\/command-args>/)?.[1]!.trim();
  return args ? `${name} ${args}` : name;
}

/** Pull display text out of a user event, whether content is a string or an array of blocks. */
export function extractUserText(event: Record<string, unknown>): string {
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = (content as ({ type?: unknown; text?: unknown } | null)[])
      .filter((b): b is { type: string; text: string } => typeof b?.text === 'string' && b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text;
  }
  return '';
}

// --- The history: a session's requests and what came back ---

/**
 * The fold's state, record by record: every exchange so far, and a slash command waiting for its answer.
 * A slash command is a request only once claude answers it — `/review` is one, `/model` is not, and nothing in the command line tells them apart (arguments do not: `/learn` is answered with none, `/model` is not with one) — so it waits here until an assistant record arrives, and is dropped if the user sends something else first.
 * It waits across reads as well, since the answer can land in the next read of a file claude is still writing.
 */
export interface HistoryFold {
  exchanges: Exchange[];
  /** Each exchange's parent record in the transcript's tree, index for index, so the next request can tell whether it replaces the last. */
  parents: (string | null)[];
  /** The latest exchange hanging off each parent record, so a request can find the one it replaces or rewinds past. */
  byParent: Map<string, number>;
  /**
   * Every record folded, by uuid, with its parent: the tree the rewinds are told from, and what a record written again is known by.
   * After a compaction Claude Code writes much of the conversation into the file a second time, under the same uuids; folding the copies drew each of those requests, and claude's messages, twice.
   */
  records: Map<string, string | null>;
  /** The first exchange changed before the last since the reader last looked, by a rewind; null when none was. */
  changedFrom: number | null;
  pending: { exchange: Exchange; parent: string | null } | null;
}

export function newFold(): HistoryFold {
  return { exchanges: [], parents: [], byParent: new Map(), records: new Map(), changedFrom: null, pending: null };
}

/** Claude Code's own records, written into the user's turn: a local command's output, a reminder, a task notification, `!` bash mode. */
const PLUMBING = /^<[a-z][a-z-]*>/;

/** A tool call as the history shows it: its name, and apart from it, on one line, the one input that says what it acted on. */
function toolPart(part: { name?: unknown; input?: unknown }): ReplyPart {
  const name = typeof part.name === 'string' ? part.name : 'tool';
  const input = (part.input ?? {}) as Record<string, unknown>;
  const main = [input.file_path, input.path, input.command, input.pattern, input.url, input.query, input.description].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  // Its first line as written, not trimmed: a pattern's trailing space is part of what was searched for.
  const first = main?.split('\n').find((line) => line.trim() !== '') ?? '';
  return { kind: 'tool', name, detail: first.length > 120 ? `${first.slice(0, 119)}…` : first };
}

function exchangeOf(record: Record<string, unknown>, request: string, kind: Exchange['kind']): Exchange {
  return {
    id: typeof record.uuid === 'string' ? record.uuid : '',
    time: typeof record.timestamp === 'string' ? record.timestamp : '',
    request,
    kind,
    replaced: false,
    rewound: false,
    parts: [],
  };
}

function parentOf(record: Record<string, unknown>): string | null {
  return typeof record.parentUuid === 'string' ? record.parentUuid : null;
}

/**
 * Add a request.
 * One that hangs off the same parent as an earlier one went back to before it:
 * - the one just before is REPLACED — claude stopped and the request sent again, or edited and resent;
 * - one further back, with every request since following on from it, is REWOUND past, and all of those with it — claude's rewind.
 * A same-parent request further back that the ones since do not all descend from is left unmarked: nothing on the machine this was written on was like that once records written twice were skipped, so there is no case to say what it means.
 */
function push(fold: HistoryFold, exchange: Exchange, parent: string | null): void {
  const last = fold.exchanges.length - 1;
  const earlier = parent === null ? undefined : fold.byParent.get(parent);
  if (earlier === last && last >= 0) fold.exchanges[last]!.replaced = true;
  else if (earlier !== undefined) rewind(fold, earlier, last);
  fold.exchanges.push(exchange);
  fold.parents.push(parent);
  if (parent !== null) fold.byParent.set(parent, fold.exchanges.length - 1);
}

/** Mark exchange `from` and every one up to `last` rewound, when each of them followed on from `from`. */
function rewind(fold: HistoryFold, from: number, last: number): void {
  const root = fold.exchanges[from]!.id;
  for (let k = from + 1; k <= last; k++) if (!descends(fold, fold.exchanges[k]!.id, root)) return;
  for (let k = from; k <= last; k++) fold.exchanges[k]!.rewound = true;
  fold.changedFrom = Math.min(fold.changedFrom ?? from, from);
}

/** Whether record `uuid` follows on from record `ancestor`, up the parent links; a compaction cuts them, so nothing after one descends from anything before it. */
function descends(fold: HistoryFold, uuid: string, ancestor: string): boolean {
  let at: string | null | undefined = uuid;
  for (let steps = 0; at && steps <= fold.records.size; steps++) {
    if (at === ancestor) return true;
    at = fold.records.get(at);
  }
  return false;
}

/** A waiting slash command becomes a request: claude is answering it. */
function promote(fold: HistoryFold): void {
  if (!fold.pending) return;
  push(fold, fold.pending.exchange, fold.pending.parent);
  fold.pending = null;
}

/** Whether a user record carries a tool's result: a request inside it was sent while that tool ran. */
function carriesToolResult(record: Record<string, unknown>): boolean {
  const content = (record.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) && content.some((part) => (part as { type?: unknown } | null)?.type === 'tool_result');
}

/**
 * Fold one transcript record into the history.
 * A request is what the user sent: a typed prompt (with or without a pasted image), one sent while a tool ran, one queued while claude worked (a `queued_command` attachment, which is not a user record at all), and a slash command claude answered.
 * Not a request: tool results, meta records (a skill's expanded body, a message from another session), compaction summaries, interruptions, and Claude Code's own tag-wrapped plumbing.
 * The rule and the counts behind it are in docs/architecture.md, In-session history.
 */
export function foldRecord(fold: HistoryFold, record: Record<string, unknown>): void {
  // A record written again is the one already folded, with its bookkeeping (git branch, version) brought up to date: the first copy stands.
  if (typeof record.uuid === 'string') {
    if (fold.records.has(record.uuid)) return;
    fold.records.set(record.uuid, parentOf(record));
  }
  if (record.isSidechain === true) return;
  if (record.type === 'attachment') {
    const attachment = record.attachment as { type?: unknown; prompt?: unknown } | undefined;
    if (attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string' || !attachment.prompt.trim()) return;
    // Queued means claude was working, so a command still waiting is the thing it was working on.
    promote(fold);
    // Claude Code's own plumbing is queued the same way — a task notification — and is no more a request here than when it comes as a user record.
    if (PLUMBING.test(attachment.prompt.trim())) return;
    push(fold, exchangeOf(record, attachment.prompt.trim(), 'busy'), parentOf(record));
    return;
  }
  if (record.type === 'assistant') {
    promote(fold);
    const last = fold.exchanges[fold.exchanges.length - 1];
    // Before the first request there is nothing for it to be a reply to.
    if (!last) return;
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return;
    // In the order claude wrote them, each message its own part, with the tool calls where they came: that is how claude itself shows a reply.
    // A message's id is its record's uuid and its place among that record's messages, stable across reads and copied by a fork, so a pin on it holds.
    const uuid = typeof record.uuid === 'string' ? record.uuid : '';
    const time = typeof record.timestamp === 'string' ? record.timestamp : '';
    let messages = 0;
    for (const part of content as ({ type?: unknown; text?: unknown; name?: unknown; input?: unknown } | null)[]) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        last.parts.push({ kind: 'text', id: uuid ? `${uuid}:${messages++}` : '', time, text: part.text });
      } else if (part?.type === 'tool_use') {
        last.parts.push(toolPart(part));
      }
    }
    return;
  }
  if (record.type !== 'user' || record.isMeta === true || record.isCompactSummary === true) return;
  const text = extractUserText(record);
  // A tool's result, with nothing the user wrote beside it.
  if (!text) return;
  if (text.includes('<command-name>')) {
    fold.pending = { exchange: exchangeOf(record, commandLabel(text), 'command'), parent: parentOf(record) };
    return;
  }
  if (PLUMBING.test(text) || text.startsWith('[Request interrupted')) return;
  fold.pending = null;
  const busy = carriesToolResult(record) || record.promptSource === 'queued';
  push(fold, exchangeOf(record, text, busy ? 'busy' : 'typed'), parentOf(record));
}

/** Where the history of one transcript has been read to. */
interface Cursor {
  /** Changes when the file is read again from the start, so a caller knows that what it holds is stale. */
  generation: number;
  offset: number;
  /**
   * The bytes after the last newline: a line claude has not finished writing.
   * Bytes rather than text, since a read can end inside a multi-byte character.
   */
  carry: Buffer;
  fold: HistoryFold;
  /** One read at a time per file, so two callers never fold the same bytes twice. */
  queue: Promise<unknown>;
}

const cursors = new Map<string, Cursor>();
/** Cursors kept at once, the least recently asked for going first; the largest session's history is about a megabyte. */
const MAX_CURSORS = 16;
let generations = 0;

/** How much is read at a time, so a 50 MB transcript is read in pieces with the main process handed back between them. */
const CHUNK_BYTES = 4 * 1024 * 1024;

function restart(cursor: Cursor): void {
  cursor.generation = ++generations;
  cursor.offset = 0;
  cursor.carry = Buffer.alloc(0);
  cursor.fold = newFold();
}

function foldLine(fold: HistoryFold, line: string): void {
  if (!line.trim()) return;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (record !== null && typeof record === 'object') foldRecord(fold, record as Record<string, unknown>);
}

/** Read what was appended to the file since the cursor's offset, or the whole file again when it shrank. */
async function readOn(file: string, cursor: Cursor, chunkBytes: number): Promise<void> {
  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch (error) {
    const failure = fsFailure(error);
    if (failure) logOnce('warn', 'history', `cannot read ${file}: ${failure}`);
    return;
  }
  try {
    const { size } = await handle.stat();
    // Shorter than what was already read means it is not the same file any more.
    if (size < cursor.offset) restart(cursor);
    while (cursor.offset < size) {
      const chunk = Buffer.alloc(Math.min(chunkBytes, size - cursor.offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, cursor.offset);
      if (bytesRead === 0) break;
      cursor.offset += bytesRead;
      const bytes = cursor.carry.length > 0 ? Buffer.concat([cursor.carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
      const end = bytes.lastIndexOf(0x0a);
      if (end < 0) {
        cursor.carry = Buffer.from(bytes);
        continue;
      }
      // A newline byte never occurs inside a multi-byte UTF-8 character, so cutting at the last one leaves whole characters on both sides.
      for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) foldLine(cursor.fold, line);
      cursor.carry = Buffer.from(bytes.subarray(end + 1));
    }
  } catch (error) {
    logOnce('warn', 'history', `cannot read ${file}: ${fsFailure(error) ?? 'it disappeared while being read'}`);
  } finally {
    await handle.close();
  }
}

/**
 * The history of the transcript at `file`, for a caller that holds `known` exchanges of `generation`.
 * The first call reads the whole file; later calls read only what was appended, and where the answer starts is `readFrom`'s rule (src/shared/history.ts).
 */
export function readHistory(file: string, known: number, generation: number, chunkBytes = CHUNK_BYTES): Promise<HistorySlice> {
  let cursor = cursors.get(file);
  if (cursor) {
    cursors.delete(file);
  } else {
    cursor = { generation: 0, offset: 0, carry: Buffer.alloc(0), fold: newFold(), queue: Promise.resolve() };
    restart(cursor);
  }
  cursors.set(file, cursor);
  // A Map iterates in insertion order and the one just asked for was re-inserted last, so the first key is the least recently asked for; the loop condition guarantees there is one.
  while (cursors.size > MAX_CURSORS) cursors.delete(cursors.keys().next().value!);

  const at = cursor;
  const read = at.queue.then(async () => {
    await readOn(file, at, chunkBytes);
    const total = at.fold.exchanges.length;
    const from = readFrom(known, total, generation === at.generation, at.fold.changedFrom);
    at.fold.changedFrom = null;
    const exchanges = at.fold.exchanges.slice(from).map((e) => ({ ...e, parts: e.parts.map((p) => ({ ...p })) }));
    return { generation: at.generation, from, exchanges, total };
  });
  at.queue = read.catch(() => undefined);
  return read;
}
