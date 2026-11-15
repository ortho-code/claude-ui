import { afterAll, beforeAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A throwaway repository in the system's temp folder for each test, since what the diff reads is git's own answer.
 * The person's own git config is kept out, the global and the system one, so their signing or hooks never reach a test's commit.
 * Remote branches are refs written in place, as a fetch would leave them, so no remote has to exist.
 */

const quiet = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const saved: Record<string, string | undefined> = {};
let dir = '';

export const repo = (): string => dir;

export const git = (...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', '-C', dir, ...args], { encoding: 'utf8' }).trim();

export const write = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
};

/** Commit everything, and answer the new commit. */
export const commit = (message: string): string => {
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', message);
  return git('rev-parse', 'HEAD');
};

/** Point a remote branch at `sha`, as a fetch would. */
export const remoteBranch = (ref: string, sha: string): void => {
  git('update-ref', `refs/remotes/${ref}`, sha);
};

/** Name `ref` as its remote's default branch, as a clone does for `origin`. */
export const remoteDefault = (ref: string): void => {
  const remote = ref.split('/')[0];
  git('symbolic-ref', `refs/remotes/${remote}/HEAD`, `refs/remotes/${ref}`);
};

/** A fresh repository for each test, the person's git config kept out for the whole file. */
export function useRepo(): void {
  beforeAll(() => {
    for (const [name, value] of Object.entries(quiet)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
  });
  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  beforeEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(path.join(os.tmpdir(), 'claude-ui-diff-'));
    git('init', '-q');
  });
}
