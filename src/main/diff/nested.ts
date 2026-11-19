import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { git } from '../git';

/** How far down a repository inside a folder is looked for: deep enough for `wp-content/themes/<theme>` from a WordPress install's own folder, shallow enough to stay quick on a large tree. */
const DEPTH = 3;

/** Folders never looked into by name: installed packages, and git's own folder. */
const SKIPPED = new Set(['node_modules', 'vendor', '.git']);

/** The most git's answer about a folder's repository may print: one path. */
const PATH_CAP = 64 * 1024;

/**
 * The repositories inside `dir`, up to `DEPTH` folders down, by their roots, sorted: each folder holding a `.git` of its own that git takes for a repository, one sharing the repository `dir` is in left out, such as a linked worktree of it, and a repository found looked into further.
 * The worktrees `claude -w` makes under `.claude/worktrees` are not looked into: they are the repository's own checkouts.
 * A folder link is not followed, so a link back up cannot loop; a folder that cannot be read is passed over.
 */
export async function nestedRepositories(dir: string): Promise<string[]> {
  const own = await repositoryOf(dir);
  const found: string[] = [];
  let level = [dir];
  for (let depth = 1; depth <= DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const parent of level) {
      for (const entry of await entriesOf(parent)) {
        if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
        const child = path.join(parent, entry.name);
        if (child.endsWith(`${path.sep}.claude${path.sep}worktrees`)) continue;
        next.push(child);
        if (!(await holdsGit(child))) continue;
        const repository = await repositoryOf(child);
        if (repository !== null && repository !== own) found.push(child);
      }
    }
    level = next;
  }
  return found.sort();
}

/** The repository `dir` is in, as git's own folder for it, which a linked worktree shares with the checkout it was made from; null for a folder git takes for none. */
async function repositoryOf(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'], PATH_CAP)).toString('utf8').trim() || null;
  } catch {
    return null;
  }
}

async function entriesOf(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Whether `dir` has a `.git` of its own: a folder for a clone, a file for a linked worktree or a submodule. */
async function holdsGit(dir: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}
