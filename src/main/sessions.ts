import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SessionSummary } from '../shared/types';

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
      { timeout: 3000 },
    );
    const [toplevel, commonDir] = stdout.trim().split('\n');
    const mainRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : toplevel;
    info = {
      repoRoot: mainRoot || cwd,
      worktree: toplevel && toplevel !== mainRoot ? path.basename(toplevel) : '',
      isRepo: true,
    };
  } catch {
    // Not a git repo, git missing, or the directory is gone: fall through to the path fallback.
  }
  // When git can't tell us it's a worktree (most importantly, when the worktree directory was removed), recognize the `claude -w` layout: <repo>/.claude/worktrees/<name>.
  // That path only exists inside a repo, so it's a repo even though git couldn't answer.
  if (!info.worktree) {
    const match = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
    if (match) info = { repoRoot: match[1], worktree: match[2], isRepo: true };
  }
  repoCache.set(cwd, info);
  return info;
}

// Per-file summary cache keyed by mtime+size, so a disk change only re-reads the files that actually changed instead of all of them every time. In-memory only — a restart rebuilds it.
const summaryCache = new Map<string, { key: string; summary: SessionSummary | null }>();

// Summarize a file, reusing the cached result while its mtime+size are unchanged.
// Caches ONLY a completed summarize; a read error keeps the previous entry rather than poisoning the cache, and presence is driven by readdir (a gone file is skipped, never served stale).
async function summarizeCached(file: string): Promise<SessionSummary | null> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = summaryCache.get(file);
  if (cached?.key === key) return cached.summary;

  let summary: SessionSummary | null;
  try {
    summary = await summarizeFile(file);
  } catch {
    return cached?.summary ?? null;
  }
  if (summary) {
    const repo = await resolveRepo(summary.cwd);
    summary.repoRoot = repo.repoRoot;
    summary.worktree = repo.worktree;
    summary.isRepo = repo.isRepo;
  }
  summaryCache.set(file, { key, summary });
  return summary;
}

/** Whether a path is a directory right now. A file sitting where a folder was is as unusable as nothing at all, so it is not enough to ask whether the path exists. */
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
  } catch {
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

  const summaries = (await Promise.all(files.map(summarizeCached))).filter(
    (s): s is SessionSummary => s !== null,
  );

  // DOES THE FOLDER STILL EXIST, asked fresh on every listing rather than cached beside the summary: a folder can be removed or put back without the transcript changing, and a stale yes is what let a session start somewhere nobody chose.
  // One stat per distinct path, not per session — hundreds of sessions share a handful of directories.
  const dirs = new Set(summaries.flatMap((s) => [s.cwd, s.repoRoot]));
  const exists = new Map(
    await Promise.all([...dirs].map(async (dir) => [dir, await isDirectory(dir)] as const)),
  );
  for (const s of summaries) {
    s.cwdExists = exists.get(s.cwd) ?? false;
    s.repoRootExists = exists.get(s.repoRoot) ?? false;
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
  await shell.trashItem(target);
}

/** Summarize one transcript without loading the whole file into memory. */
async function summarizeFile(file: string): Promise<SessionSummary | null> {
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
  // A session can ENTER a worktree mid-life (the EnterWorktree hook): the transcript stays in its original project dir and only a worktree-state event records the move, so the first-latched cwd goes stale.
  // The LAST worktree-state wins: entered (a worktreeSession object) puts the session at worktreePath; exited (worktreeSession null) drops it back to the recorded original cwd.
  let worktreeStateCwd: string | null = null;
  let worktreeOriginalCwd = '';
  // lastActivity = the last user/assistant MESSAGE timestamp, not the file mtime: a background/system append (a Remote Control notice) or a resume bumps mtime without being real activity.
  // Captured with a cheap regex below.
  let lastMsgTs = '';

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      // Keep the latest model an assistant message reported. A cheap regex (not a full parse) so it doesn't defeat the early-continue below; assistant lines carry `"model":"claude-…"`.
      const modelMatch = line.match(/"model":"(claude-[^"]+)"/);
      if (modelMatch) model = modelMatch[1];

      // Last message's timestamp (lastActivity): a cheap regex before the early-continue, so it sees every message line without a full parse. Overwrites, so the final value is the newest message.
      if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
        const tsMatch = line.match(/"timestamp":"([^"]+)"/);
        if (tsMatch) lastMsgTs = tsMatch[1];
      }

      // Title events recur through the file, so always parse them to keep the latest.
      // A real compaction is a structured system/compact_boundary event, not the bare word "compactMetadata" (which also appears in message text) — so pre-filter cheaply on that string, then confirm by type below.
      // While awaiting the first message after a boundary, keep parsing to capture it.
      // Otherwise stop parsing once we have cwd and the first message; keep counting.
      const isTitle = line.includes('"custom-title"') || line.includes('"ai-title"');
      const maybeBoundary = line.includes('compact_boundary');
      const maybeWorktree = line.includes('worktree-state');
      if (!isTitle && !maybeBoundary && !maybeWorktree && !awaitingCompactHead && cwd && firstMessage && conversationId) continue;

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
      else if (!firstMessage && event.type === 'user') firstMessage = commandLabel(displayableUserText(extractUserText(event)));

      if (event.type === 'worktree-state') {
        const ws = event.worktreeSession as { worktreePath?: unknown; originalCwd?: unknown } | null;
        if (ws && typeof ws.worktreePath === 'string') {
          worktreeStateCwd = ws.worktreePath;
          if (typeof ws.originalCwd === 'string') worktreeOriginalCwd = ws.originalCwd;
        } else {
          // Exited (worktreeSession null carries no path); fall back to the enter event's original cwd.
          worktreeStateCwd = worktreeOriginalCwd || null;
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
  return {
    id,
    conversationId,
    cwd: resolvedCwd,
    // Filled in by listSessions once the repo is resolved; default to the cwd's own group.
    repoRoot: resolvedCwd,
    worktree: '',
    isRepo: false,
    title: title.slice(0, 200),
    firstMessage: firstMessage.slice(0, 200),
    model,
    lastActivity,
    // Sibling grouping is derived across the whole session list in listSessions; default to "alone".
    isSibling: false,
    siblingIds: [],
    postCompactHeads,
    // Both re-derived per listing, like the sibling marks: a folder can be removed or put back without the transcript changing, so the answer cannot be cached beside one.
    cwdExists: true,
    repoRootExists: true,
  };
}

/** A title field is usable only when it is a non-empty string. */
function asTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A message that is pure local-command plumbing — the `<local-command-caveat>` preamble a session gets when it starts with local commands, or captured `<local-command-stdout>` output — is not a usable first message; blank it so the latch waits for the first real prompt instead.
 */
function displayableUserText(text: string): string {
  return /^<local-command-(caveat|stdout)>/.test(text.trim()) ? '' : text;
}

/**
 * A session started by a slash command wraps its first message in tags — `<command-message>word</command-message>\n<command-name>/cmd</command-name>` plus an optional (possibly empty) `<command-args>…</command-args>` — which reads as junk in the row.
 * Render it as the command line the user effectively typed: "/cmd args".
 * Anything else passes through untouched.
 */
function commandLabel(text: string): string {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1].trim();
  if (!name) return text;
  const args = text.match(/<command-args>([^<]*)<\/command-args>/)?.[1].trim();
  return args ? `${name} ${args}` : name;
}

/** Pull display text out of a user event, whether content is a string or an array of blocks. */
function extractUserText(event: Record<string, unknown>): string {
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

/** Fallback when no event carried a cwd: Claude Code encodes the path with dashes. */
function decodeProjectDir(name: string): string {
  return name.replace(/-/g, '/');
}
