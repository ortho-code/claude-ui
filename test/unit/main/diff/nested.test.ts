import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { nestedRepositories } from '../../../../src/main/diff/nested';

// A folder of folders in the system's temp folder for each test, some of them repositories, since what is found is what git says each one is.

let top = '';

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (dir: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', '-C', dir, ...args], { env, stdio: 'ignore' });
};

/** A repository at `rel` under the test's folder, with one commit, so it can have worktrees. */
function repoAt(rel: string): string {
  const dir = path.join(top, rel);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  writeFileSync(path.join(dir, 'README.md'), rel);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

const at = (rel: string): string => path.join(top, rel);

beforeEach(() => {
  top = mkdtempSync(path.join(os.tmpdir(), 'nested-'));
});

afterEach(() => {
  rmSync(top, { recursive: true, force: true });
});

describe('nestedRepositories', () => {
  it('finds the repositories in a folder that is none, down to three folders and not four', async () => {
    mkdirSync(at('site'));
    repoAt('site/wp-content/themes/theme');
    repoAt('site/plugin');
    repoAt('site/a/b/c/too-deep');
    expect(await nestedRepositories(at('site'))).toEqual([at('site/plugin'), at('site/wp-content/themes/theme')]);
  });

  it('finds a clone inside a repository, and leaves out the repository’s own worktrees, under .claude/worktrees or elsewhere', async () => {
    const main = repoAt('main');
    repoAt('main/libs/clone');
    git(main, 'worktree', 'add', '-q', path.join(main, '.claude/worktrees/fix'));
    git(main, 'worktree', 'add', '-q', path.join(main, 'side'));
    expect(await nestedRepositories(main)).toEqual([at('main/libs/clone')]);
  });

  it('finds a clone inside a worktree that `claude -w` made, which is a repository of its own', async () => {
    const main = repoAt('main');
    const fix = path.join(main, '.claude/worktrees/fix');
    git(main, 'worktree', 'add', '-q', fix);
    const clone = path.join(fix, 'libs/clone');
    mkdirSync(clone, { recursive: true });
    git(clone, 'init', '-q');
    expect(await nestedRepositories(fix)).toEqual([clone]);
  });

  it('looks into no node_modules or vendor folder, and follows no folder link', async () => {
    mkdirSync(at('app'));
    repoAt('app/node_modules/pkg');
    repoAt('app/vendor/lib');
    const outside = repoAt('outside');
    symlinkSync(outside, at('app/linked'));
    expect(await nestedRepositories(at('app'))).toEqual([]);
  });
});
