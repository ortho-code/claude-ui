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

/** Read every session transcript under ~/.claude/projects and summarize each. */
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

  const summaries = (await Promise.all(files.map(summarizeFile))).filter(
    (s): s is SessionSummary => s !== null,
  );

  // Resolve repo grouping once per distinct cwd, then annotate each session.
  const cwds = [...new Set(summaries.map((s) => s.cwd))];
  const repos = new Map(await Promise.all(cwds.map(async (cwd) => [cwd, await resolveRepo(cwd)] as const)));
  for (const summary of summaries) {
    const info = repos.get(summary.cwd);
    if (info) {
      summary.repoRoot = info.repoRoot;
      summary.worktree = info.worktree;
    }
  }

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
  let eventCount = 0;

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      eventCount++;

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
    lastActivity: stat.mtime.toISOString(),
    eventCount,
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
