import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import type { WorkingTree } from '../shared/panels';

/**
 * A fingerprint of a folder's git working tree, for a panel that runs again when it changes.
 *
 * GIT'S OWN VIEW, ASKED, NOT A WATCH OF EVERY FILE (measured 2026-10-08 on a large repository): one watch per directory, skipping a fixed list of heavy folders, took 44,287 watches and 160 MB of memory, and Node's recursive watch takes one per file and per directory, past the system's limit there unfiltered; `git status --porcelain=v2 --branch -uall` there took 0.07 s.
 * Git's ignore rules come with it, so build output and `node_modules` never count where git ignores them.
 * `--no-optional-locks` keeps every call from refreshing the index, which `git status` otherwise writes after a change, holding its lock meanwhile, which `man git-status` warns may make other git processes running then fail.
 * `status.showStash` is switched off whatever the person's config says, since its line is the whole repository's, and git's messages are asked for in English, since which refusal is which is read from them.
 */

const execFileAsync = promisify(execFile);

/** How long one git call may take; a look that cannot answer in this says nothing either way. */
const GIT_TIMEOUT_MS = 10_000;

/** The most one `git status` may print, every changed and untracked path under the folder; past it the look says nothing either way rather than hold more. */
const STATUS_CAP = 16 * 1024 * 1024;

const NUL = 0;
const SPACE = 0x20;

/** Git in `dir`, with no optional locks, as raw bytes: a path git prints is the file system's bytes, which need not be UTF-8. */
async function git(dir: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-c', 'status.showStash=false', '-C', dir, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: STATUS_CAP,
    encoding: 'buffer',
    env: { ...process.env, LC_ALL: 'C' },
  });
  return stdout;
}

/**
 * Git's refusals that mean the folder is in no working tree: outside any repository, inside a `.git` or a bare one, and, through `-C`, a folder that is not there.
 * Git exits 128 for every fatal error, a broken repository or one it does not trust among them, so the exit alone cannot tell these from git not answering.
 */
const NOT_A_TREE = /not a git repository|must be run in a work tree|cannot change to/;

/** What a failed git call said, on stderr where git says it. */
function failure(error: unknown): string {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8').trim();
  return stderr || (error instanceof Error ? error.message : String(error));
}

/** The field of a `--porcelain=v2` record the path starts at, by the record's first letter: ordinary, renamed or copied, unmerged, untracked. */
const PATH_FIELD: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 };

/**
 * Every path a `git status --porcelain=v2 -z` lists, relative to the repository's root, as bytes.
 * A renamed or copied entry's original path comes as a record of its own after it, and is listed too.
 */
export function statusPaths(status: Buffer): Buffer[] {
  const paths: Buffer[] = [];
  let at = 0;
  let original = false;
  while (at < status.length) {
    let end = status.indexOf(NUL, at);
    if (end < 0) end = status.length;
    const record = status.subarray(at, end);
    at = end + 1;
    if (original) {
      paths.push(record);
      original = false;
      continue;
    }
    const field = PATH_FIELD[String.fromCharCode(record[0] ?? 0)];
    if (field === undefined) continue;
    // The path is everything after that many spaces, spaces of its own included.
    let start = 0;
    for (let seen = 0; seen < field && start >= 0; seen++) {
      const space = record.indexOf(SPACE, start);
      start = space < 0 ? -1 : space + 1;
    }
    if (start > 0) paths.push(record.subarray(start));
    original = record[0] === '2'.charCodeAt(0);
  }
  return paths;
}

/** A listed path's size and modification time, so a second edit of a file git already lists as changed changes the fingerprint too; `gone` for one that cannot be looked at, deleted or otherwise. */
async function stamp(root: Buffer, file: Buffer): Promise<string> {
  try {
    const stat = await fs.lstat(Buffer.concat([root, Buffer.from('/'), file]));
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'gone';
  }
}

/**
 * The working tree at `dir`, and everything under it: what `git status` lists there, each listed path's size and modification time, and the folder's own tree at `HEAD`, which a commit or a checkout changes only when it changes that folder.
 * Not `--branch`: its lines are the whole repository's, so a commit anywhere would count for a panel on one folder.
 */
export async function workingTree(dir: string): Promise<WorkingTree> {
  let root: Buffer;
  try {
    root = (await git(dir, ['rev-parse', '--show-toplevel'])).subarray(0, -1);
  } catch (error) {
    const said = failure(error);
    return (error as { code?: unknown }).code === 128 && NOT_A_TREE.test(said) ? { kind: 'none' } : { kind: 'failed', error: said };
  }
  try {
    const [head, status] = await Promise.all([
      // `--verify --quiet` answers a tree there is not with exit 1 and nothing said: a repository without a commit yet, or a folder never committed, which is a state like any other.
      // Any other failure is git not answering, which must not read as a change.
      git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD:./']).catch((error: unknown) => {
        if ((error as { code?: unknown }).code === 1) return Buffer.alloc(0);
        throw error;
      }),
      git(dir, ['status', '--porcelain=v2', '--untracked-files=all', '-z', '--', '.']),
    ]);
    const stamps = await Promise.all(statusPaths(status).map((file) => stamp(root, file)));
    const hash = createHash('sha1').update(head).update('\0').update(status).update('\0').update(stamps.join('\0'));
    return { kind: 'tree', fingerprint: hash.digest('hex') };
  } catch (error) {
    return { kind: 'failed', error: failure(error) };
  }
}
