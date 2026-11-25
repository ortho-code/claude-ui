import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { readAppended, type TranscriptCursor } from './transcript';
import { fileChangeCalls } from './tool-calls';

/**
 * WHAT A SESSION'S FILE TOOLS CHANGED, read from its transcript: for each file, its first change that succeeded, and where the text it had before that change is.
 * Claude Code records that text in the change's result: a Write that created the file had none, and an Edit or a Write that replaced the file keeps it as `originalFile`, which is null in many results.
 * A NotebookEdit's result names it otherwise, and is read as one whose text is not recorded.
 * The text itself is read again from its record when asked for (`textBefore`), rather than held, since a session can change hundreds of files.
 * A change made through a shell command leaves no such record, so it is not here.
 */

/** Where the text a file had before the session first changed it is found. */
export type StartText = { kind: 'created' } | { kind: 'recorded'; transcript: string; offset: number } | { kind: 'unknown' };

/** A file's first change by the session that succeeded: when, as its result's record says, and where the text before it is. */
export interface FirstWrite {
  at: string;
  start: StartText;
}

/** Where a read of one transcript has got to. */
interface WritesRead extends TranscriptCursor {
  /** Changes asked for whose result has not come yet, the file each changes by the call's id. */
  pending: Map<string, string>;
  writes: Map<string, FirstWrite>;
  /** One read at a time per transcript, so two callers never fold the same bytes twice. */
  queue: Promise<unknown>;
}

const reads = new Map<string, WritesRead>();
/** Transcripts kept read at once, the least recently asked for going first. */
const MAX_READS = 16;

/** The tool results a user record carries, each by the call it answers and whether it was an error. */
function toolResults(record: Record<string, unknown>): { id: string; error: boolean }[] {
  const content = (record.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) => {
    const block = part as { type?: unknown; tool_use_id?: unknown; is_error?: unknown } | null;
    return block?.type === 'tool_result' && typeof block.tool_use_id === 'string' ? [{ id: block.tool_use_id, error: block.is_error === true }] : [];
  });
}

/**
 * Where the text before a change is, from the record carrying its result at `offset`.
 * `toolUseResult` is one per record, so a record answering several calls cannot say which of them it describes, and says nothing.
 */
function startOf(record: Record<string, unknown>, results: number, transcript: string, offset: number): StartText {
  if (results !== 1) return { kind: 'unknown' };
  const result = record.toolUseResult as { type?: unknown; originalFile?: unknown } | null | undefined;
  if (result?.type === 'create') return { kind: 'created' };
  if (typeof result?.originalFile === 'string') return { kind: 'recorded', transcript, offset };
  return { kind: 'unknown' };
}

function fold(read: WritesRead, transcript: string, record: Record<string, unknown>, offset: number): void {
  if (record.type === 'assistant') {
    for (const { id, file } of fileChangeCalls(record)) read.pending.set(id, file);
    return;
  }
  if (record.type !== 'user') return;
  const results = toolResults(record);
  for (const { id, error } of results) {
    const file = read.pending.get(id);
    if (file === undefined) continue;
    read.pending.delete(id);
    if (error || read.writes.has(file)) continue;
    read.writes.set(file, { at: typeof record.timestamp === 'string' ? record.timestamp : '', start: startOf(record, results.length, transcript, offset) });
  }
}

/** The first change of each file the transcript at `transcript` records, reading only what was appended since it was last asked. */
function writesIn(transcript: string): Promise<ReadonlyMap<string, FirstWrite>> {
  let read = reads.get(transcript);
  if (read) reads.delete(transcript);
  else read = { offset: 0, carry: Buffer.alloc(0), pending: new Map(), writes: new Map(), queue: Promise.resolve() };
  reads.set(transcript, read);
  // A Map iterates in insertion order and the one just asked for was re-inserted last, so the first key is the least recently asked for.
  while (reads.size > MAX_READS) reads.delete(reads.keys().next().value!);
  const at = read;
  const done = at.queue.then(async () => {
    await readAppended(
      transcript,
      at,
      (record, offset) => fold(at, transcript, record, offset),
      () => {
        at.pending = new Map();
        at.writes = new Map();
      },
      'touched',
    );
    return at.writes;
  });
  at.queue = done.catch(() => undefined);
  return done;
}

/** The transcripts of a session's subagents, which Claude Code keeps in a folder named for the session beside its transcript. */
async function subagentTranscripts(transcript: string): Promise<string[]> {
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  const names = await fs.readdir(dir).catch(() => []);
  return names.filter((name) => name.endsWith('.jsonl')).map((name) => path.join(dir, name));
}

/** The first change of `file` that succeeded by the session whose transcript is `transcript`, or by any of its subagents, whichever came first; undefined for a file none of them changed. */
export async function firstWrite(transcript: string, file: string): Promise<FirstWrite | undefined> {
  const all = await Promise.all([transcript, ...(await subagentTranscripts(transcript))].map((each) => writesIn(each)));
  return all.map((writes) => writes.get(file)).reduce<FirstWrite | undefined>((first, each) => (each && (!first || each.at < first.at) ? each : first), undefined);
}

/** How much of a transcript is read at a time while looking for the end of one record. */
const LINE_CHUNK = 1024 * 1024;

/** The text a file had before its first change, '' for a file the change created; null where it is not recorded, or its record can no longer be read. */
export async function textBefore(start: StartText): Promise<string | null> {
  if (start.kind === 'created') return '';
  if (start.kind === 'unknown') return null;
  const line = await lineAt(start.transcript, start.offset).catch(() => null);
  if (line === null) return null;
  try {
    const record = JSON.parse(line) as { toolUseResult?: { originalFile?: unknown } };
    return typeof record.toolUseResult?.originalFile === 'string' ? record.toolUseResult.originalFile : null;
  } catch {
    return null;
  }
}

/** The line of `file` starting at byte `offset`, read up to its newline. */
async function lineAt(file: string, offset: number): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const pieces: Buffer[] = [];
    for (let at = offset; ; ) {
      const chunk = Buffer.alloc(LINE_CHUNK);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, at);
      const end = chunk.subarray(0, bytesRead).indexOf(0x0a);
      pieces.push(chunk.subarray(0, end < 0 ? bytesRead : end));
      if (end >= 0 || bytesRead === 0) break;
      at += bytesRead;
    }
    return Buffer.concat(pieces).toString('utf8');
  } finally {
    await handle.close();
  }
}
