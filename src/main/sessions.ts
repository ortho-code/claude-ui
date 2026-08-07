import { app, shell } from 'electron';
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
}

// A cwd's repo layout is effectively stable, so cache it and never re-run git for the same path.
const repoCache = new Map<string, RepoInfo>();

/**
 * Resolve which repo a directory belongs to, and whether it is a linked git worktree.
 * `--show-toplevel` is the directory's own working-tree root; `--git-common-dir` is the main
 * repo's `.git`, so its parent is the main repo root. A worktree's toplevel differs from that.
 */
async function resolveRepo(cwd: string): Promise<RepoInfo> {
  const cached = repoCache.get(cwd);
  if (cached) return cached;

  let info: RepoInfo = { repoRoot: cwd, worktree: '' };
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
    };
  } catch {
    // Not a git repo, git missing, or the directory is gone: fall through to the path fallback.
  }
  // When git can't tell us it's a worktree (most importantly, when the worktree directory was
  // removed), recognize the `claude -w` layout: <repo>/.claude/worktrees/<name>.
  if (!info.worktree) {
    const match = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/);
    if (match) info = { repoRoot: match[1], worktree: match[2] };
  }
  repoCache.set(cwd, info);
  return info;
}

// Per-file summary cache keyed by mtime+size, so a disk change only re-reads the files that
// actually changed instead of all of them every time. In-memory only — a restart rebuilds it.
const summaryCache = new Map<string, { key: string; summary: SessionSummary | null }>();

// Summarize a file, reusing the cached result while its mtime+size are unchanged. Caches ONLY a
// completed summarize; a read error keeps the previous entry rather than poisoning the cache, and
// presence is driven by readdir (a gone file is skipped, never served stale).
async function summarizeCached(file: string): Promise<SessionSummary | null> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = summaryCache.get(file);
  if (cached && cached.key === key) return cached.summary;

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
  }
  summaryCache.set(file, { key, summary });
  return summary;
}

/** Read every session transcript under ~/.claude/projects and summarize each. */
interface ForkMeta {
  /** Ordered user/assistant message uuids — a fork's sequence shares its parent's as a prefix. */
  uuidSeq: string[];
  /** Has a compaction event; such a branch is a compaction artifact, not a user fork. */
  hasCompact: boolean;
  /** File creation time (ms); a fork's file is created after its parent's, so this orders a family. */
  createdMs: number;
}
const forkMetaCache = new Map<string, { key: string; meta: ForkMeta }>();

// Full read of a transcript's message-uuid sequence (+ compaction flag), cached by mtime+size. Only
// called for conversations with >1 file (fork candidates), since it reads the whole file.
async function readForkMeta(file: string): Promise<ForkMeta> {
  const stat = await fs.stat(file);
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = forkMetaCache.get(file);
  if (cached && cached.key === key) return cached.meta;

  const uuidSeq: string[] = [];
  let hasCompact = false;
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!hasCompact && line.includes('compactMetadata')) hasCompact = true;
      if (!line.includes('"uuid"')) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if ((e.type === 'user' || e.type === 'assistant') && typeof e.uuid === 'string') uuidSeq.push(e.uuid);
      } catch {
        // skip malformed line
      }
    }
  } finally {
    rl.close();
  }
  // birthtime is 0 on filesystems that don't record it; ctime (inode change) is the best fallback.
  const meta: ForkMeta = { uuidSeq, hasCompact, createdMs: stat.birthtimeMs || stat.ctimeMs };
  forkMetaCache.set(file, { key, meta });
  return meta;
}

interface ForkMember {
  id: string;
  /** This session's message uuids. Order doesn't matter here — lineage uses the SET (see below). */
  uuidSeq: string[];
  hasCompact: boolean;
  /** File creation time (ms); orders a family so a fork's parent is one created before it. */
  createdMs: number;
  /** Tie-break only, when two members were created in the same millisecond. */
  lastActivity: string;
}

// Derive fork lineage within one conversation family (sessions sharing a first-message uuid).
//
// `claude --fork-session` COPIES the parent's messages (keeping their uuids), so a fork's message
// SET is a superset of the parent's-at-fork-time. Both sides can then keep going, so neither is a
// prefix of the other — and a positional prefix comparison is worse than that: one duplicated or
// inserted message shifts every later index, so two branches of the same conversation can look like
// they diverge far earlier than they do. So we compare by SHARED MESSAGE SET, which is immune to
// shifts, duplicates, and reordering.
//
// Each branch's parent is the EARLIER-created member it shares the most messages with (creation time
// orients direction: a fork's file is created after the parent it was copied from). The earliest
// non-compaction member is the base. This is tree-aware: a fork of a fork contains its immediate
// parent's messages plus more, so it overlaps that parent more than the root and resolves to it.
// Two forks of one parent each overlap the parent more than each other, so both attach to the parent
// rather than chaining. Compaction branches are never forks (they collapse into the base elsewhere).
export function deriveForkLineage(members: ForkMember[]): Map<string, { isFork: boolean; parentId: string | null }> {
  const out = new Map<string, { isFork: boolean; parentId: string | null }>();
  for (const m of members) out.set(m.id, { isFork: false, parentId: null });

  // Only real (non-compaction) branches form the fork tree; order them oldest-first.
  const real = members
    .filter((m) => !m.hasCompact)
    .sort((a, b) => a.createdMs - b.createdMs || a.lastActivity.localeCompare(b.lastActivity));
  const sets = new Map(real.map((m) => [m.id, new Set(m.uuidSeq)]));

  const overlap = (a: Set<string>, b: Set<string>): number => {
    let n = 0;
    for (const u of a) if (b.has(u)) n += 1;
    return n;
  };

  for (let i = 0; i < real.length; i += 1) {
    const x = real[i];
    const xs = sets.get(x.id)!;
    let parent: ForkMember | null = null;
    let best = 0;
    // Candidate parents are the members created before x; the closest ancestor shares the most
    // messages. Ties keep the earlier-created candidate (real is sorted oldest-first).
    for (let j = 0; j < i; j += 1) {
      const shared = overlap(sets.get(real[j].id)!, xs);
      if (shared > best) {
        best = shared;
        parent = real[j];
      }
    }
    if (parent) out.set(x.id, { isFork: true, parentId: parent.id });
  }
  return out;
}

// Deriving fork lineage means reading whole transcripts, but the result is IMMUTABLE as a session
// grows: appending messages to a branch never changes which earlier session it overlaps most — only
// adding or removing a file in the family can change the tree. So we cache the derived result per
// conversation, keyed by the family's set of file ids, and recompute only when that set changes (a
// fork appears or is removed), NOT on every write while a fork is active. The cache is persisted to
// disk so a restart reuses it instead of re-reading transcripts cold. Bump the version whenever
// deriveForkLineage's logic changes, so stale results are discarded.
interface ForkLineage {
  isFork: boolean;
  parentId: string | null;
  forkCount: number;
}
interface ForkLineageEntry {
  /** The family's sorted file ids; a change here (not mere growth) invalidates the entry. */
  setKey: string;
  members: Record<string, ForkLineage>;
}
const FORK_LINEAGE_VERSION = 1;
let forkLineageCache: Map<string, ForkLineageEntry> | null = null;

function forkLineagePath(): string {
  return path.join(app.getPath('userData'), 'fork-lineage.json');
}

async function loadForkLineage(): Promise<Map<string, ForkLineageEntry>> {
  if (forkLineageCache) return forkLineageCache;
  try {
    const parsed = JSON.parse(await fs.readFile(forkLineagePath(), 'utf8')) as {
      version?: number;
      conversations?: Record<string, ForkLineageEntry>;
    };
    forkLineageCache =
      parsed.version === FORK_LINEAGE_VERSION && parsed.conversations
        ? new Map(Object.entries(parsed.conversations))
        : new Map();
  } catch {
    forkLineageCache = new Map(); // absent or unreadable: start empty
  }
  return forkLineageCache;
}

async function saveForkLineage(cache: Map<string, ForkLineageEntry>): Promise<void> {
  const file = forkLineagePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data = { version: FORK_LINEAGE_VERSION, conversations: Object.fromEntries(cache) };
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file); // atomic replace, same as meta.ts
}

export async function listSessions(): Promise<SessionSummary[]> {
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(projectsDir, e.name));
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const dir of projectDirs) {
    const entries = await fs.readdir(dir);
    for (const name of entries) {
      if (name.endsWith('.jsonl')) files.push(path.join(dir, name));
    }
  }

  const summaries = (await Promise.all(files.map(summarizeCached))).filter(
    (s): s is SessionSummary => s !== null,
  );

  // Fork lineage: only conversations with more than one file can contain forks. The derived tree is
  // cached by the family's file-id set (immutable as sessions grow), so the heavy transcript read
  // runs only when that set changes — see the ForkLineage cache above.
  const byConversation = new Map<string, SessionSummary[]>();
  for (const s of summaries) {
    const group = byConversation.get(s.conversationId);
    if (group) group.push(s);
    else byConversation.set(s.conversationId, [s]);
  }
  const fileById = new Map(files.map((f) => [path.basename(f, '.jsonl'), f]));
  const lineageCache = await loadForkLineage();
  const multiFile = new Set<string>();
  let lineageDirty = false;
  for (const [conversationId, group] of byConversation) {
    if (group.length < 2) continue;
    multiFile.add(conversationId);
    const setKey = group
      .map((s) => s.id)
      .sort()
      .join(',');
    let entry = lineageCache.get(conversationId);
    if (!entry || entry.setKey !== setKey) {
      // Set changed (a fork/branch appeared or was removed): recompute from fresh transcript reads.
      const members = await Promise.all(
        group.map(async (s) => {
          const meta = await readForkMeta(fileById.get(s.id)!);
          return { id: s.id, uuidSeq: meta.uuidSeq, hasCompact: meta.hasCompact, createdMs: meta.createdMs, lastActivity: s.lastActivity };
        }),
      );
      const lineage = deriveForkLineage(members);
      const childCount = new Map<string, number>();
      for (const { parentId } of lineage.values()) {
        if (parentId) childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
      }
      const membersOut: Record<string, ForkLineage> = {};
      for (const [id, l] of lineage) {
        membersOut[id] = { isFork: l.isFork, parentId: l.parentId, forkCount: childCount.get(id) ?? 0 };
      }
      entry = { setKey, members: membersOut };
      lineageCache.set(conversationId, entry);
      lineageDirty = true;
    }
    for (const s of group) {
      const l = entry.members[s.id];
      if (!l) continue;
      s.isFork = l.isFork;
      s.parentId = l.parentId;
      s.forkCount = l.forkCount;
    }
  }

  // Drop cache entries for files/conversations that no longer exist (bounded memory; readdir is
  // authoritative). A family that shrank below two files is no longer multi-file, so its lineage
  // entry is dropped too.
  const present = new Set(files);
  for (const cachedPath of summaryCache.keys()) if (!present.has(cachedPath)) summaryCache.delete(cachedPath);
  for (const cachedPath of forkMetaCache.keys()) if (!present.has(cachedPath)) forkMetaCache.delete(cachedPath);
  for (const conversationId of lineageCache.keys()) {
    if (!multiFile.has(conversationId)) {
      lineageCache.delete(conversationId);
      lineageDirty = true;
    }
  }
  if (lineageDirty) await saveForkLineage(lineageCache);

  return summaries.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/**
 * Move the given sessions' transcript files and subagent dirs to the OS trash (recoverable),
 * across whichever project directories hold them. This is the only place the app mutates the
 * Claude session store.
 */
export async function trashSessions(ids: string[]): Promise<void> {
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(projectsDir, e.name));
  } catch {
    return;
  }
  for (const dir of projectDirs) {
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
  let eventCount = 0;

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      eventCount++;

      // Keep the latest model an assistant message reported. A cheap regex (not a full parse) so it
      // doesn't defeat the early-continue below; assistant lines carry `"model":"claude-…"`.
      const modelMatch = line.match(/"model":"(claude-[^"]+)"/);
      if (modelMatch) model = modelMatch[1];

      // Title events recur through the file, so always parse them to keep the latest.
      // Otherwise stop parsing once we have cwd and the first message; keep counting.
      const isTitle = line.includes('"custom-title"') || line.includes('"ai-title"');
      if (!isTitle && cwd && firstMessage && conversationId) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
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
      else if (!firstMessage && event.type === 'user') firstMessage = extractUserText(event);
    }
  } finally {
    rl.close();
  }

  // No user/assistant message means an empty stub (e.g. a background-agent artifact); hide it.
  if (!conversationId) return null;

  const title = asTitle(customTitle) || asTitle(aiTitle);
  const stat = await fs.stat(file);
  const resolvedCwd = cwd || decodeProjectDir(path.basename(path.dirname(file)));
  return {
    id,
    conversationId,
    cwd: resolvedCwd,
    // Filled in by listSessions once the repo is resolved; default to the cwd's own group.
    repoRoot: resolvedCwd,
    worktree: '',
    title: title.slice(0, 200),
    firstMessage: firstMessage.slice(0, 200),
    model,
    lastActivity: stat.mtime.toISOString(),
    eventCount,
    // Fork lineage is derived across the whole family in listSessions; default to "not a fork".
    isFork: false,
    parentId: null,
    forkCount: 0,
  };
}

/** A title field is usable only when it is a non-empty string. */
function asTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Pull display text out of a user event, whether content is a string or an array of blocks. */
function extractUserText(event: Record<string, unknown>): string {
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = content
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
