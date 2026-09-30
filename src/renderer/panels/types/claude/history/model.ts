import type { Exchange, HistorySlice, ReplyPart } from '../../../../../shared/types';

type TextPart = Extract<ReplyPart, { kind: 'text' }>;
type ToolPart = Extract<ReplyPart, { kind: 'tool' }>;

/** What a reply is drawn as: each of claude's messages, a tool call standing alone, and a run of tool calls folded to one line, keyed by where the run starts in the reply. */
export type ReplyBlock = { kind: 'text'; part: TextPart } | { kind: 'tool'; part: ToolPart } | { kind: 'tools'; at: number; parts: ToolPart[] };

/** The tools that change files: each keeps its own line, as claude shows an edit apart from the reading and running around it. */
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * A reply as it is drawn: two or more tool calls in a row, between claude's messages, fold to one line; a lone one stays itself, since its own line says more than a count of one.
 * An edit is never folded and ends a run, so the changes to files stay in view.
 * A run's key is the index of its first call, which stays put while the last exchange grows.
 */
export function replyBlocks(parts: readonly ReplyPart[]): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let run: ToolPart[] = [];
  let at = 0;
  const flush = (): void => {
    if (run.length === 1) blocks.push({ kind: 'tool', part: run[0]! });
    else if (run.length > 1) blocks.push({ kind: 'tools', at, parts: run });
    run = [];
  };
  parts.forEach((part, index) => {
    if (part.kind === 'tool' && !EDITS.has(part.name)) {
      if (run.length === 0) at = index;
      run.push(part);
      return;
    }
    flush();
    blocks.push(part.kind === 'text' ? { kind: 'text', part } : { kind: 'tool', part });
  });
  flush();
  return blocks;
}

/** How a folded run names what its tools did, in claude's words where claude's are known; tools that share a phrase share a count. */
const PHRASES: Record<string, [one: string, many: string]> = {
  Bash: ['ran 1 shell command', 'ran # shell commands'],
  Read: ['read 1 file', 'read # files'],
  Grep: ['searched for 1 pattern', 'searched for # patterns'],
  Glob: ['searched for 1 pattern', 'searched for # patterns'],
  WebFetch: ['fetched 1 page', 'fetched # pages'],
  WebSearch: ['searched the web once', 'searched the web # times'],
  Agent: ['ran 1 agent', 'ran # agents'],
  Task: ['ran 1 agent', 'ran # agents'],
};

/** A folded run's line: "Ran 4 shell commands, read 1 file", in the order the tools first came; any other tool by its name and count. */
export function toolSummary(parts: readonly ToolPart[]): string {
  const counts = new Map<string, { forms: [string, string] | null; name: string; count: number }>();
  for (const part of parts) {
    const forms = PHRASES[part.name] ?? null;
    const key = forms ? forms[1] : part.name;
    const entry = counts.get(key) ?? { forms, name: part.name, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const text = [...counts.values()].map(({ forms, name, count }) => (forms ? (count === 1 ? forms[0] : forms[1].replace('#', String(count))) : `${name} ×${count}`)).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the window holds of one session's history: the exchanges, and which read of the transcript they come from. */
export interface HistoryModel {
  generation: number;
  exchanges: Exchange[];
}

export function emptyModel(): HistoryModel {
  return { generation: 0, exchanges: [] };
}

/**
 * Apply a read of the transcript, and say from which exchange on anything changed, so only those are drawn again.
 * Another generation means the transcript was read again from the start, so everything held is replaced.
 */
export function applySlice(model: HistoryModel, slice: HistorySlice): number {
  if (slice.generation !== model.generation) {
    model.generation = slice.generation;
    model.exchanges = [...slice.exchanges];
    return 0;
  }
  model.exchanges.splice(slice.from, model.exchanges.length - slice.from, ...slice.exchanges);
  return slice.from;
}

/** The first line of a request, cut for a label: what a tooltip or a list names it by. */
export function requestLabel(request: string, max = 120): string {
  const first = request.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
