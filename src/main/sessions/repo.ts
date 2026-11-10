import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { errorText, logOnce } from '../logs/log';
import { formatDuration } from '../files/stamp';

const execFileAsync = promisify(execFile);

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
export async function resolveRepo(cwd: string): Promise<RepoInfo> {
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

/**
 * Whether a path is a directory right now.
 * A file sitting where a folder was is as unusable as nothing at all, so it is not enough to ask whether the path exists.
 */
export async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A repo's checkouts, the main one first, as `git worktree list` gives them, through their real paths where they are there; null when the repo is gone or git cannot say.
 * A worktree whose folder was removed by hand stays listed, as prunable, until git prunes it.
 */
export async function checkoutsOf(repoRoot: string): Promise<string[] | null> {
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
export async function ignoredIn(root: string, files: string[]): Promise<Set<string> | null> {
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
export function realFolder(dir: string): Promise<string> {
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
