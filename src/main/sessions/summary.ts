import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { prKey } from '../../shared/sessions/prs';
import type { SessionPr, SessionSummary } from '../../shared/types';
import { postedPrs } from './posted-prs';
import { promptOf } from './transcript';

/** What one transcript says, before its folders are resolved to a repo. */
export interface SummaryRead {
  summary: SessionSummary;
  /** The path of the worktree the session last entered, when it has left it since; '' otherwise. */
  leftWorktreePath: string;
  /** Whether it left that worktree by claude's ExitWorktree tool rather than by closing there (`SessionSummary.movedOutOfWorktree`). */
  movedOut: boolean;
  /** Each file claude changed with a file tool, at its newest change, newest first. */
  changes: FileChange[];
  /** Where in the transcript the session last entered or left a worktree, by `worktree-state`; -1 for never. */
  movedAt: number;
}

/** A file claude changed: where in the transcript, by line, and when, as its record says. */
export interface FileChange {
  file: string;
  position: number;
  at: string;
}

/** Claude's tools that change a file, each with the input that names it. */
const FILE_TOOLS = new Map([
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
]);

/** A line that may call one of them, before it is parsed. */
const FILE_TOOL_CALL = new RegExp(`"name":"(?:${[...FILE_TOOLS.keys()].join('|')})"`);

/** Claude's tools that run a shell command, each given as its `command` input. */
const SHELL_TOOLS = ['Bash', 'PowerShell'];

/** A line that may call one of them, before it is parsed. */
const SHELL_TOOL_CALL = new RegExp(`"name":"(?:${SHELL_TOOLS.join('|')})"`);

/** The tool calls in an assistant record, each by its tool's name and its input. */
function toolCalls(event: Record<string, unknown>): { name: string; input: unknown }[] {
  const content = (event.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null) return [];
    const { type, name, input } = part as { type?: unknown; name?: unknown; input?: unknown };
    return type === 'tool_use' && typeof name === 'string' ? [{ name, input }] : [];
  });
}

/** The commands an assistant record's shell-tool calls run. */
function shellCommands(event: Record<string, unknown>): string[] {
  return toolCalls(event).flatMap(({ name, input }) => {
    if (!SHELL_TOOLS.includes(name)) return [];
    const command = (input as { command?: unknown } | undefined)?.command;
    return typeof command === 'string' ? [command] : [];
  });
}

/** Summarize one transcript without loading the whole file into memory. */
export async function summarizeFile(file: string): Promise<SummaryRead | null> {
  const id = path.basename(file, '.jsonl');
  let cwd = '';
  let firstMessage = '';
  let conversationId = '';
  let customTitle: unknown = null;
  let aiTitle: unknown = null;
  let model = '';
  const postCompactHeads: string[] = [];
  // Set right after a compaction boundary so the next user/assistant message is captured as a head.
  let awaitingCompactHead = false;
  // A session can ENTER a worktree mid-life (claude's EnterWorktree tool): the transcript stays in its original project dir and only a worktree-state event records the move, so the first-latched cwd goes stale.
  // The LAST worktree-state wins: entered (a worktreeSession object) puts the session at worktreePath; exited (worktreeSession null) drops it back to the recorded original cwd.
  let worktreeStateCwd: string | null = null;
  let worktreeOriginalCwd = '';
  // An exit does not undo where the session did its work, so the worktree it last entered is kept through one, and a later enter clears it.
  let enteredWorktreePath = '';
  let leftWorktreePath = '';
  // Whether the session is in a worktree by its records, so only the first null after an entry is an exit: Claude Code writes null again and again after an exit, at each resume too.
  let inWorktree = false;
  // An exit is a MOVE when claude's ExitWorktree tool made it, and a close otherwise, since Claude Code writes the same records when a session closes in its worktree.
  // The call has been seen two records after its exit, in the same turn, so it counts before the exit or after it until the next user record: a call after a later prompt, such as one a resume brings, is not the exit's, and Claude Code refuses it for a worktree from an earlier session.
  let exitCalled = false;
  let exitAwaitsCall = false;
  let movedOut = false;
  // Where the session changed files, against where it last moved by a worktree tool, so a move after its last change wins and a change after a move does.
  // Positions, not times, order the two: a `worktree-state` record carries no timestamp.
  const changes = new Map<string, FileChange>();
  let movedAt = -1;
  let position = 0;
  // lastActivity = the last user/assistant MESSAGE timestamp, not the file mtime: a background/system append (a Remote Control notice) or a resume bumps mtime without being real activity.
  // Captured with a cheap regex below.
  let lastMsgTs = '';
  // The PRs the transcript links, by `prKey`.
  // Claude Code writes the same record again through a session, so each is kept once, where it first appears, as spelt there.
  const prs = new Map<string, SessionPr>();
  const keepPr = (pr: SessionPr): void => {
    const key = prKey(pr);
    if (!prs.has(key)) prs.set(key, pr);
  };

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      position++;
      if (!line.trim()) continue;

      // Keep the latest model an assistant message reported.
      // A cheap regex (not a full parse) so it doesn't defeat the early-continue below; assistant lines carry `"model":"claude-…"`.
      const modelMatch = line.match(/"model":"(claude-[^"]+)"/);
      if (modelMatch) model = modelMatch[1]!;

      // Last message's timestamp (lastActivity): a cheap regex before the early-continue, so it sees every message line without a full parse.
      // Overwrites, so the final value is the newest message.
      // A user record is looked for first, as it always was: it finds its type near the start of the line, where a search for the other type would read all of a long tool result.
      const isUser = line.includes('"type":"user"');
      const isAssistant = !isUser && line.includes('"type":"assistant"');
      if (isUser || isAssistant) {
        const tsMatch = line.match(/"timestamp":"([^"]+)"/);
        if (tsMatch) lastMsgTs = tsMatch[1]!;
      }

      // Title events recur through the file, so always parse them to keep the latest.
      // A real compaction is a structured system/compact_boundary event, not the bare word "compactMetadata" (which also appears in message text) — so pre-filter cheaply on that string, then confirm by type below.
      // While awaiting the first message after a boundary, keep parsing to capture it.
      // Otherwise stop parsing once we have cwd and the first message; keep counting.
      const isTitle = line.includes('"custom-title"') || line.includes('"ai-title"');
      const maybeBoundary = line.includes('compact_boundary');
      const maybeWorktree = line.includes('worktree-state');
      const maybePrLink = line.includes('"pr-link"');
      const maybeExitCall = line.includes('"ExitWorktree"');
      // Searched only in claude's own records, which keeps it off the long tool results and replayed requests.
      const maybeChange = isAssistant && FILE_TOOL_CALL.test(line);
      const maybePost = isAssistant && line.includes('gh ') && SHELL_TOOL_CALL.test(line);
      // Read before the lines below are skipped unparsed, as a user record mostly is.
      if (exitAwaitsCall && line.includes('"type":"user"')) exitAwaitsCall = false;
      if (!isTitle && !maybeBoundary && !maybeWorktree && !maybePrLink && !maybeExitCall && !maybeChange && !maybePost && !awaitingCompactHead && cwd && firstMessage && conversationId) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (!cwd && typeof event.cwd === 'string') cwd = event.cwd;
      // The first user/assistant message's uuid identifies the conversation; branches share it.
      if (!conversationId && (event.type === 'user' || event.type === 'assistant') && typeof event.uuid === 'string') {
        conversationId = event.uuid;
      }
      if (event.type === 'custom-title') customTitle = event.customTitle;
      else if (event.type === 'ai-title') aiTitle = event.aiTitle;
      else if (!firstMessage && event.type === 'user') firstMessage = promptOf(event);

      if (event.type === 'worktree-state') {
        const ws = event.worktreeSession as { worktreePath?: unknown; originalCwd?: unknown } | null;
        if (ws && typeof ws.worktreePath === 'string') {
          // Claude Code writes the state again with each turn while the session is in its worktree, and a repeat is no move.
          if (!inWorktree || worktreeStateCwd !== ws.worktreePath) movedAt = position;
          worktreeStateCwd = ws.worktreePath;
          enteredWorktreePath = ws.worktreePath;
          leftWorktreePath = '';
          if (typeof ws.originalCwd === 'string') worktreeOriginalCwd = ws.originalCwd;
          inWorktree = true;
          exitCalled = false;
          exitAwaitsCall = false;
          movedOut = false;
        } else {
          // Exited (worktreeSession null carries no path); fall back to the enter event's original cwd.
          worktreeStateCwd = worktreeOriginalCwd || null;
          leftWorktreePath = enteredWorktreePath;
          if (inWorktree) {
            movedOut = exitCalled;
            exitAwaitsCall = !exitCalled;
            movedAt = position;
          }
          inWorktree = false;
        }
      }

      if (maybeExitCall && event.type === 'assistant' && callsTool(event, 'ExitWorktree')) {
        // Before its exit, it is waited for; after it, in the same turn, it settles the exit already read as a close.
        if (inWorktree) exitCalled = true;
        else if (exitAwaitsCall) movedOut = true;
      }

      // Only claude's own records: a transcript's `api-request-blob` records replay earlier calls, with no timestamp, wherever they are written.
      if (maybeChange && event.type === 'assistant') {
        for (const changed of changedFiles(event)) {
          // Moved to the end, so the map runs oldest to newest change.
          changes.delete(changed);
          changes.set(changed, { file: changed, position, at: typeof event.timestamp === 'string' ? event.timestamp : '' });
        }
      }

      if (event.type === 'pr-link') {
        const pr = linkedPr(event);
        if (pr) keepPr(pr);
      }

      // A review or comment claude posted links its PR: Claude Code links none for a review, nor for a comment posted through `gh api`.
      if (maybePost && event.type === 'assistant') {
        for (const command of shellCommands(event)) for (const pr of postedPrs(command)) keepPr(pr);
      }

      // Real compaction boundary; the following user/assistant message is the post-compaction head.
      if (event.type === 'system' && event.subtype === 'compact_boundary') {
        awaitingCompactHead = true;
      } else if (awaitingCompactHead && (event.type === 'user' || event.type === 'assistant') && typeof event.uuid === 'string') {
        postCompactHeads.push(event.uuid);
        awaitingCompactHead = false;
      }
    }
  } finally {
    rl.close();
  }

  // No user/assistant message means an empty stub (e.g. a background-agent artifact); hide it.
  if (!conversationId) return null;

  const title = asTitle(customTitle) || asTitle(aiTitle);
  const stat = await fs.stat(file);
  // The worktree-state override beats the first-latched cwd; resolveRepo then maps a worktree path to its repo + badge through the same path it uses for `claude -w` sessions.
  const resolvedCwd = worktreeStateCwd || cwd || decodeProjectDir(path.basename(path.dirname(file)));
  const lastActivity = lastMsgTs || stat.mtime.toISOString();
  const summary: SessionSummary = {
    id,
    conversationId,
    cwd: resolvedCwd,
    // Filled in by listSessions once the repo is resolved; default to the cwd's own group.
    repoRoot: resolvedCwd,
    worktree: '',
    leftWorktree: '',
    movedOutOfWorktree: false,
    // Set per listing, from the checkout chosen with the summary, while that checkout's folder is there.
    workCwd: '',
    // Set per listing too, from the checkouts read with the summary and whether each folder is there.
    checkouts: [],
    isRepo: false,
    title: title.slice(0, 200),
    firstMessage: firstMessage.slice(0, 200),
    model,
    lastActivity,
    // Sibling grouping is derived across the whole session list in listSessions; default to "alone".
    isSibling: false,
    siblingIds: [],
    prs: [...prs.values()],
    postCompactHeads,
    // Both re-derived per listing, like the sibling marks: a folder can be removed or put back without the transcript changing, so the answer cannot be cached beside one.
    cwdExists: true,
    repoRootExists: true,
  };
  return { summary, leftWorktreePath, movedOut: leftWorktreePath !== '' && movedOut, changes: [...changes.values()].reverse(), movedAt };
}

/** The absolute paths an assistant record's file-tool calls change; a relative one names no file anyone can find. */
function changedFiles(event: Record<string, unknown>): string[] {
  return toolCalls(event).flatMap(({ name, input }) => {
    const field = FILE_TOOLS.get(name);
    const file = field && typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[field] : undefined;
    return typeof file === 'string' && path.isAbsolute(file) ? [file] : [];
  });
}

/** Whether an assistant record calls the tool `name`. */
function callsTool(event: Record<string, unknown>, name: string): boolean {
  return toolCalls(event).some((call) => call.name === name);
}

/** The PR a `pr-link` record names, or null for a record this cannot use: its number a positive whole number, its repository a name, its page an https address. */
function linkedPr(event: Record<string, unknown>): SessionPr | null {
  const { prNumber, prRepository, prUrl } = event;
  if (typeof prNumber !== 'number' || !Number.isInteger(prNumber) || prNumber <= 0) return null;
  if (typeof prRepository !== 'string' || !prRepository) return null;
  if (typeof prUrl !== 'string' || !prUrl.startsWith('https://')) return null;
  return { repository: prRepository, number: prNumber, url: prUrl };
}

/** A title field is usable only when it is a non-empty string. */
function asTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Fallback when no event carried a cwd: Claude Code encodes the path with dashes. */
function decodeProjectDir(name: string): string {
  return name.replace(/-/g, '/');
}
