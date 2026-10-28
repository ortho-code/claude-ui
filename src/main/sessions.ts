import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prReference } from '../shared/prs';
import type { SessionCheckout, SessionPr, SessionSummary } from '../shared/types';
import { errorText, fsFailure, log, logOnce } from './log';
import { formatDuration } from './stamp';
import { promptOf } from './transcript';

const execFileAsync = promisify(execFile);
const projectsDir = path.join(os.homedir(), '.claude', 'projects');

interface RepoInfo {
  /** The main repo root; sessions group under this. */
  repoRoot: string;
  /** The linked-worktree name, or '' for the main tree / a non-repo directory. */
  worktree: string;
  /** Whether the directory is inside a git repo (so it can host worktree sessions). */
  isRepo: boolean;
}

// A cwd's repo layout is effectively stable, so cache it and never re-run git for the same path.
const repoCache = new Map<string, RepoInfo>();

/** How long `git rev-parse` gets before a directory is treated as not a repo. */
const GIT_TIMEOUT_MS = 3000;

/**
 * Resolve which repo a directory belongs to, and whether it is a linked git worktree.
 * `--show-toplevel` is the directory's own working-tree root; `--git-common-dir` is the main repo's `.git`, so its parent is the main repo root.
 * A worktree's toplevel differs from that.
 */
async function resolveRepo(cwd: string): Promise<RepoInfo> {
  const cached = repoCache.get(cwd);
  if (cached) return cached;

  let info: RepoInfo = { repoRoot: cwd, worktree: '', isRepo: false };
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { timeout: GIT_TIMEOUT_MS },
    );
    const [toplevel, commonDir] = stdout.trim().split('\n');
    if (toplevel && commonDir) {
      const mainRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : toplevel;
      info = {
        repoRoot: mainRoot || cwd,
        worktree: toplevel !== mainRoot ? path.basename(toplevel) : '',
        isRepo: true,
      };
    }
  } catch (error) {
    // Not a git repo, git missing, or the directory is gone: fall through to the path fallback.
    // Two of those are worth a line, because the answer is cached for the rest of the run: git itself missing, and git too slow to answer, which files a real repo as none.
    // MEASURED: with `-C`, a gone directory is git's own exit 128 like any non-repo, so ENOENT is only ever the binary; a timeout sets `killed`.
    const failed = error as NodeJS.ErrnoException & { killed?: boolean };
    if (failed.code === 'ENOENT') logOnce('warn', 'sessions', 'git not found on PATH: no session is recognised as being in a repo or a worktree');
    else if (failed.killed) logOnce('warn', 'sessions', `git took over ${formatDuration(GIT_TIMEOUT_MS)} in ${cwd}: treated as not a repo until a restart`);
  }
  // When git can't tell us it's a worktree (most importantly, when the worktree directory was removed), recognize the `claude -w` layout: <repo>/.claude/worktrees/<name>.
  // That path only exists inside a repo, so it's a repo even though git couldn't answer.
  if (!info.worktree) {
    const match = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
    if (match) info = { repoRoot: match[1]!, worktree: match[2]!, isRepo: true };
  }
  repoCache.set(cwd, info);
  return info;
}

/** A summary as the listing caches it: the session, and the checkouts it changed files in, which its work folder is chosen from. */
interface Summarized {
  summary: SessionSummary;
  /** Every checkout of its repo the session changed a file in, newest first, when one is not the checkout it runs in; empty otherwise, and for a session git could not answer about. */
  checkouts: ChangedCheckout[];
  /** The root of the checkout it works in when that is not the one `cwd` is in, '' otherwise; whether it is still there is asked per listing. */
  work: string;
  /** The root of the worktree its mark names, where it runs or that it left, when `checkouts` has others to list it with; '' otherwise. */
  own: string;
  /** The checkout a list of it alone says nothing about: the worktree its mark names, or for a session without one the checkout it runs in; '' when `checkouts` is empty. */
  alone: string;
}

/** What one listing asks git once, however many transcripts it re-reads: each repo's checkouts. */
type ListingPass = Map<string, Promise<string[] | null>>;

// Per-file summary cache keyed by mtime+size, so a disk change only re-reads the files that actually changed instead of all of them every time.
// In-memory only — a restart rebuilds it.
const summaryCache = new Map<string, { key: string; summarized: Summarized | null }>();

// Summarize a file, reusing the cached result while its mtime+size are unchanged.
// Caches ONLY a completed summarize; a read error keeps the previous entry rather than poisoning the cache, and presence is driven by readdir (a gone file is skipped, never served stale).
async function summarizeCached(file: string, pass: ListingPass): Promise<Summarized | null> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = summaryCache.get(file);
  if (cached?.key === key) return cached.summarized;

  let read: SummaryRead | null;
  try {
    read = await summarizeFile(file);
  } catch (error) {
    // Gone since the stat is a race; anything else keeps that session out of the list, or stale in it, on every listing.
    const failure = fsFailure(error);
    if (failure) logOnce('warn', 'sessions', `cannot read ${file}: ${failure}`);
    return cached?.summarized ?? null;
  }
  let summarized: Summarized | null = null;
  if (read) {
    const { summary, leftWorktreePath, movedOut } = read;
    const repo = await resolveRepo(summary.cwd);
    summary.repoRoot = repo.repoRoot;
    summary.worktree = repo.worktree;
    summary.isRepo = repo.isRepo;
    // Named the way the worktree it is in is named, so the two badges agree; once the tree is removed only the `.claude/worktrees/<name>` fallback still names it.
    if (!repo.worktree && leftWorktreePath) summary.leftWorktree = (await resolveRepo(leftWorktreePath)).worktree;
    summary.movedOutOfWorktree = summary.leftWorktree !== '' && movedOut;
    // The folder of the worktree its mark names, by the path it was entered at for one it left.
    const marked = summary.worktree ? summary.cwd : summary.leftWorktree ? leftWorktreePath : '';
    summarized = { summary, ...(repo.isRepo ? await workOf(read, repo.repoRoot, marked, pass) : { checkouts: [], work: '', own: '', alone: '' }) };
  }
  summaryCache.set(file, { key, summarized });
  return summarized;
}

/**
 * Whether a path is a directory right now.
 * A file sitting where a folder was is as unusable as nothing at all, so it is not enough to ask whether the path exists.
 */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** The per-project directories under ~/.claude/projects ([] when the root is missing). */
async function projectDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(projectsDir, e.name));
  } catch (error) {
    // Missing is a machine with no sessions yet; unreadable is a list that stays empty with nothing on screen to say why.
    const failure = fsFailure(error);
    if (failure) logOnce('warn', 'sessions', `cannot list ${projectsDir}: ${failure}`);
    return [];
  }
}

/** Read every session transcript under ~/.claude/projects and summarize each. */
export async function listSessions(): Promise<SessionSummary[]> {
  const files: string[] = [];
  for (const dir of await projectDirs()) {
    const entries = await fs.readdir(dir);
    for (const name of entries) {
      if (name.endsWith('.jsonl')) files.push(path.join(dir, name));
    }
  }

  const pass: ListingPass = new Map();
  const listed = (await Promise.all(files.map((file) => summarizeCached(file, pass)))).filter(
    (s): s is Summarized => s !== null,
  );
  const summaries = listed.map((s) => s.summary);

  // DOES THE FOLDER STILL EXIST, asked fresh on every listing rather than cached beside the summary: a folder can be removed or put back without the transcript changing, and a stale yes is what let a session start somewhere nobody chose.
  // One stat per distinct path, not per session — hundreds of sessions share a handful of directories.
  const dirs = new Set(listed.flatMap(({ summary: s, work, checkouts, own }) => [s.cwd, s.repoRoot, ...(work ? [work] : []), ...checkouts.map(({ root }) => root), ...(own ? [own] : [])]));
  const exists = new Map(
    await Promise.all([...dirs].map(async (dir) => [dir, await isDirectory(dir)] as const)),
  );
  for (const { summary: s, work, ...worked } of listed) {
    s.cwdExists = exists.get(s.cwd) ?? false;
    s.repoRootExists = exists.get(s.repoRoot) ?? false;
    // A checkout removed since leaves the session where it runs, not in an older checkout.
    s.workCwd = work && exists.get(work) ? work : '';
    s.checkouts = listedCheckouts(worked, exists);
  }

  // Sibling grouping: sessions sharing a conversationId are one family.
  // No direction is derived — fork direction is not reliably recoverable from transcript data (see the plan) — so a multi-file family is marked as SIBLINGS.
  // Summaries are cached objects, so reset before re-deriving: a family that shrank must lose its stale marks.
  for (const s of summaries) {
    s.isSibling = false;
    s.siblingIds = [];
  }
  const byConversation = new Map<string, SessionSummary[]>();
  for (const s of summaries) {
    const group = byConversation.get(s.conversationId);
    if (group) group.push(s);
    else byConversation.set(s.conversationId, [s]);
  }

  // Case A: a fork of a COMPACTED session adopts a post-compaction head as its conversationId, so it lands in a different group than its family.
  // Union every group whose conversationId appears among a session's postCompactHeads with that session's group; union-find so chained links merge transitively.
  // Per (head, claimer) pair, because several sessions can claim the same head — the fork copies the parent's boundary, so it claims its own conversationId as a head (a no-op union).
  const parent = new Map<string, string>();
  for (const conversationId of byConversation.keys()) parent.set(conversationId, conversationId);
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  for (const s of summaries) {
    for (const head of s.postCompactHeads) {
      if (!byConversation.has(head)) continue;
      const a = find(head);
      const b = find(s.conversationId);
      if (a !== b) parent.set(a, b);
    }
  }

  const families = new Map<string, SessionSummary[]>();
  for (const [conversationId, group] of byConversation) {
    const root = find(conversationId);
    const family = families.get(root);
    if (family) family.push(...group);
    else families.set(root, [...group]);
  }
  for (const family of families.values()) {
    if (family.length < 2) continue;
    for (const s of family) {
      s.isSibling = true;
      s.siblingIds = family.filter((other) => other.id !== s.id).map((other) => other.id);
    }
  }

  // Drop cache entries for files that no longer exist (bounded memory; readdir is authoritative).
  const present = new Set(files);
  for (const cachedPath of summaryCache.keys()) if (!present.has(cachedPath)) summaryCache.delete(cachedPath);

  return summaries.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

// Whether a worktree of this name already exists for the repo (claude puts them at <repo>/.claude/worktrees/<name>), so the app can refuse to "create" a duplicate.
export async function worktreeExists(repoRoot: string, name: string): Promise<boolean> {
  return fs.stat(path.join(repoRoot, '.claude', 'worktrees', name)).then(
    () => true,
    () => false,
  );
}

/**
 * The transcript file of session `id`: from the last listing when it was in it, else by looking in every project directory.
 * Null when there is none.
 * The id arrives from the window, so it has to look like one before it goes anywhere near a path.
 */
export async function findTranscript(id: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  for (const file of summaryCache.keys()) if (path.basename(file, '.jsonl') === id) return file;
  for (const dir of await projectDirs()) {
    const file = path.join(dir, `${id}.jsonl`);
    try {
      await fs.access(file);
      return file;
    } catch {
      // Not in this project; try the next.
    }
  }
  return null;
}

/**
 * Move the given sessions' transcript files and subagent dirs to the OS trash (recoverable), across whichever project directories hold them.
 * This is the only place the app mutates the Claude session store.
 */
export async function trashSessions(ids: string[]): Promise<void> {
  for (const dir of await projectDirs()) {
    for (const id of ids) {
      await trashIfExists(path.join(dir, `${id}.jsonl`));
      await trashIfExists(path.join(dir, id));
    }
  }
}

async function trashIfExists(target: string): Promise<void> {
  try {
    await fs.access(target);
  } catch {
    return; // Not here; nothing to trash.
  }
  try {
    await shell.trashItem(target);
  } catch (error) {
    // Still rejected to the caller, which says so on screen; the log is where the reason stays.
    log('warn', 'sessions', `could not move ${target} to the trash: ${errorText(error)}`);
    throw error;
  }
}

/** What one transcript says, before its folders are resolved to a repo. */
interface SummaryRead {
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
interface FileChange {
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

/** Summarize one transcript without loading the whole file into memory. */
async function summarizeFile(file: string): Promise<SummaryRead | null> {
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
  // The PRs the transcript links, keyed by their reference, `owner/repo#number`.
  // Claude Code writes the same record again through a session, so each is kept once, where it first appears.
  const prs = new Map<string, SessionPr>();

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
      // Read before the lines below are skipped unparsed, as a user record mostly is.
      if (exitAwaitsCall && line.includes('"type":"user"')) exitAwaitsCall = false;
      if (!isTitle && !maybeBoundary && !maybeWorktree && !maybePrLink && !maybeExitCall && !maybeChange && !awaitingCompactHead && cwd && firstMessage && conversationId) continue;

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
        if (pr) {
          const key = prReference(pr);
          if (!prs.has(key)) prs.set(key, pr);
        }
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
  const content = (event.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null) return [];
    const { type, name, input } = part as { type?: unknown; name?: unknown; input?: unknown };
    const field = type === 'tool_use' && typeof name === 'string' ? FILE_TOOLS.get(name) : undefined;
    const file = field && typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[field] : undefined;
    return typeof file === 'string' && path.isAbsolute(file) ? [file] : [];
  });
}

/** A checkout a session changed a file in: its root, and its newest change there; `gone` for a worktree whose folder is not there, or that git no longer lists. */
interface ChangedCheckout {
  root: string;
  position: number;
  at: string;
  gone: boolean;
}

/**
 * WHERE A SESSION WORKS: the checkouts of its repo it changed files in, and of them the one a panel without a folder of its own runs in.
 * That is the checkout of its newest change, a file git ignores or outside the repo's checkouts passed over, so a session working in a worktree by path or by a Bash `cd` takes its panels there, and back once claude changes a file git does not ignore in the main checkout.
 * Not when it entered or left a worktree after that change, which puts it where `cwd` already says; and not when that change is in a worktree that is gone (`changedCheckouts` says which it can tell), where it falls back to `cwd` rather than to an older checkout, which would be a guess.
 * Nothing when git cannot answer, rather than an answer made without it.
 * `marked` is the folder of the worktree the session's mark names, '' for none, whose root goes with the checkouts for the mark to list them with.
 */
async function workOf(read: SummaryRead, repoRoot: string, marked: string, pass: ListingPass): Promise<Omit<Summarized, 'summary'>> {
  const none = { checkouts: [], work: '', own: '', alone: '' };
  if (read.changes.length === 0) return none;
  const listed = pass.get(repoRoot) ?? checkoutsOf(repoRoot);
  pass.set(repoRoot, listed);
  const roots = await listed;
  if (!roots) return none;
  // Most sessions change files only in the checkout they run in, or outside the repo, and work where they run whatever git ignores: their paths say so, and git is not asked which files it ignores.
  // Only a path through a link into a checkout, or from one checkout into another, would make the paths say otherwise than their real folders do.
  // Not a session that left a worktree: the checkout it runs in now is one besides the worktree its mark names, listed with it when git shows a change there.
  const runsIn = rootOf(read.summary.cwd, roots);
  const main = roots[0]!;
  if (!read.summary.leftWorktree && !read.changes.some(({ file }) => goneWorktree(file, main, roots) || ![runsIn, ''].includes(rootOf(file, roots)))) return none;
  const checkouts = await changedCheckouts(read.changes, roots);
  if (!checkouts) return none;
  const own = marked ? await checkoutOf(marked, roots) : '';
  const here = rootOf(await realFolder(read.summary.cwd), roots);
  // The answer the shortcut above gives, for a session whose paths reached another checkout but whose changes there git ignores.
  const alone = own || here;
  const newest = checkouts[0];
  if (!newest || newest.gone || newest.position < read.movedAt) return { checkouts, work: '', own, alone };
  return { checkouts, work: here === newest.root ? '' : newest.root, own, alone };
}

/** The root of the checkout a folder is in, through its real path: a gone worktree's by claude's layout, else the longest listed root holding it; '' for none. */
async function checkoutOf(dir: string, roots: string[]): Promise<string> {
  const real = await realFolder(dir);
  return goneWorktree(real, roots[0]!, roots) || rootOf(real, roots);
}

/**
 * The checkouts a session's worktree mark lists (`SessionSummary.checkouts`): those it changed a file in, newest first, and the worktree its mark names, `own`, last when it changed nothing there.
 * Gone when the reading found it so, or its folder is not there at this listing; none at all when the list would hold only `alone`, which it would say nothing about.
 */
function listedCheckouts({ checkouts, own, alone }: Omit<Summarized, 'summary' | 'work'>, exists: ReadonlyMap<string, boolean>): SessionCheckout[] {
  const listed = checkouts.map(({ root, at, gone }) => ({ root, at, gone: gone || !exists.get(root), own: root === own }));
  if (own && !listed.some((checkout) => checkout.own)) listed.push({ root: own, at: '', gone: !exists.get(own), own: true });
  return listed.some(({ root }) => root !== alone) ? listed : [];
}

/**
 * The checkouts a session changed files in, newest first, each at its newest change that counts; null when git could not say which files it ignores.
 * A file under `.claude/worktrees/<name>/` of a worktree git no longer lists is a gone worktree's, not the main checkout's it would otherwise fall in, and so is one in a listed worktree whose folder was removed by hand, which git lists as prunable until it is pruned.
 */
async function changedCheckouts(changes: FileChange[], roots: string[]): Promise<ChangedCheckout[] | null> {
  // `checkoutsOf` answers no empty list.
  const main = roots[0]!;
  const byRoot = new Map<string, ChangedCheckout>();
  const note = (root: string, change: FileChange, gone: boolean): void => {
    if (!byRoot.has(root)) byRoot.set(root, { root, position: change.position, at: change.at, gone });
  };
  const toCheck = new Map<string, FileChange[]>();
  for (const change of changes) {
    const file = path.join(await realFolder(path.dirname(change.file)), path.basename(change.file));
    const gone = goneWorktree(file, main, roots);
    if (gone) {
      note(gone, change, true);
      continue;
    }
    const root = rootOf(file, roots);
    if (root) toCheck.set(root, [...(toCheck.get(root) ?? []), { ...change, file }]);
  }
  for (const [root, inRoot] of toCheck) {
    if (!(await isDirectory(root))) {
      note(root, inRoot[0]!, true);
      continue;
    }
    const ignored = await ignoredIn(root, inRoot.map(({ file }) => file));
    if (!ignored) return null;
    const counted = inRoot.find(({ file }) => !ignored.has(file));
    if (counted) note(root, counted, false);
  }
  return [...byRoot.values()].sort((a, b) => b.position - a.position);
}

/** The root of the gone worktree a path is in, by claude's `<repo>/.claude/worktrees/<name>` layout, when git does not list that worktree; '' otherwise. */
function goneWorktree(file: string, main: string, roots: string[]): string {
  const worktrees = path.join(main, '.claude', 'worktrees');
  if (!file.startsWith(`${worktrees}/`)) return '';
  const root = path.join(worktrees, file.slice(worktrees.length + 1).split('/')[0]!);
  return roots.includes(root) ? '' : root;
}

/** The root of the checkout a path is in: the longest of `roots` that holds it, or is it; '' for none. */
function rootOf(file: string, roots: string[]): string {
  return roots.filter((root) => file === root || file.startsWith(`${root}/`)).reduce((longest, root) => (root.length > longest.length ? root : longest), '');
}

/**
 * A repo's checkouts, the main one first, as `git worktree list` gives them, through their real paths where they are there; null when the repo is gone or git cannot say.
 * A worktree whose folder was removed by hand stays listed, as prunable, until git prunes it.
 */
async function checkoutsOf(repoRoot: string): Promise<string[] | null> {
  // A repo deleted since its sessions ran has no checkouts, and git would only say so; claude's `.claude/worktrees/` layout still files those sessions under it.
  if (!(await isDirectory(repoRoot))) return null;
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], { timeout: GIT_TIMEOUT_MS });
    const roots = stdout.split('\n').flatMap((line) => (line.startsWith('worktree ') ? [line.slice('worktree '.length)] : []));
    return roots.length > 0 ? await Promise.all(roots.map((root) => fs.realpath(root).catch(() => root))) : null;
  } catch (error) {
    logOnce('warn', 'sessions', `git could not list the checkouts of ${repoRoot}: ${errorText(error)}`);
    return null;
  }
}

// What git ignores, per checkout and file, asked once a run: a file's answer changes only when an ignore rule or the index does, and a checkout git cannot answer for is asked again next time.
const ignoreCache = new Map<string, boolean>();

/**
 * Which of a checkout's files git ignores there, asked in one call; null when git cannot say.
 * Without `--no-index`, so a tracked file that matches a pattern counts as not ignored, as git shows its change.
 */
async function ignoredIn(root: string, files: string[]): Promise<Set<string> | null> {
  const key = (file: string): string => `${root}\0${file}`;
  const unknown = [...new Set(files.filter((file) => !ignoreCache.has(key(file))))];
  if (unknown.length > 0) {
    let answer: { code: number; stdout: string };
    try {
      answer = await gitWithInput(['-C', root, 'check-ignore', '--stdin', '-z', '-v', '-n'], unknown.map((file) => `${path.relative(root, file)}\0`).join(''));
    } catch (error) {
      logOnce('warn', 'sessions', `git could not say which files it ignores in ${root}: ${errorText(error)}`);
      return null;
    }
    // Exit 1 is git's answer that it ignores none of them, with the same output.
    if (answer.code !== 0 && answer.code !== 1) {
      logOnce('warn', 'sessions', `git could not say which files it ignores in ${root}: exit ${answer.code}`);
      return null;
    }
    // Four fields a file, in the order asked: the source of the rule that matched, its line, the rule, and the path; no rule, or a negated one, is not ignored.
    const fields = answer.stdout.split('\0');
    unknown.forEach((file, index) => {
      const rule = fields[index * 4 + 2] ?? '';
      ignoreCache.set(key(file), rule !== '' && !rule.startsWith('!'));
    });
  }
  return new Set(files.filter((file) => ignoreCache.get(key(file))));
}

/** Git with `input` on its stdin: its exit code and output, or a rejection when it could not run or ran past its time. */
function gitWithInput(args: string[], input: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      // An exit code is git's answer; a missing binary has a string code, and a run stopped at its time none.
      if (error && typeof error.code !== 'number') reject(new Error(errorText(error)));
      else resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout });
    });
    // A git that ends before it has read everything closes the pipe, and its exit says why.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

// A folder's real path, asked once a run.
const realFolders = new Map<string, Promise<string>>();

/**
 * A folder's real path, so a file behind a link out of the repo lands outside it; for a folder that is gone, its nearest ancestor's real path with the rest of the path kept, since a removed folder is still somewhere.
 */
function realFolder(dir: string): Promise<string> {
  let real = realFolders.get(dir);
  if (!real) {
    real = fs.realpath(dir).catch(async () => {
      const up = path.dirname(dir);
      return up === dir ? dir : path.join(await realFolder(up), path.basename(dir));
    });
    realFolders.set(dir, real);
  }
  return real;
}

/** Whether an assistant record calls the tool `name`. */
function callsTool(event: Record<string, unknown>, name: string): boolean {
  const content = (event.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) && content.some((part) => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'tool_use' && (part as { name?: unknown }).name === name);
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
