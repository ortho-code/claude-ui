import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SessionSummary } from '../../shared/types';
import { errorText, fsFailure, log, logOnce } from '../logs/log';
import { listedCheckouts, workOf, type ListingPass, type Worked } from './checkouts';
import { isDirectory, resolveRepo } from './repo';
import { summarizeFile, type SummaryRead } from './summary';

const projectsDir = path.join(os.homedir(), '.claude', 'projects');

/** A summary as the listing caches it: the session, and the checkouts it changed files in, which its work folder is chosen from. */
interface Summarized extends Worked {
  summary: SessionSummary;
}

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
