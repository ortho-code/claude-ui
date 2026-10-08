import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { statusPaths, workingTree } from '../../../src/main/gitstate';

// Against a real repository in the system's temp folder, since what is measured is git's own answer.
// The person's own git config is kept out, the global and the system one, so their signing or hooks never reach a test's commit.
const quiet = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const saved: Record<string, string | undefined> = {};
let repo: string;

const git = (...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-C', repo, ...args], { stdio: 'ignore' });
};
const write = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), text);
};
const commit = (message: string): void => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
};
const fingerprint = async (dir = repo): Promise<string> => {
  const tree = await workingTree(dir);
  if (tree.kind !== 'tree') throw new Error(`no working tree at ${dir}: ${tree.kind}`);
  return tree.fingerprint;
};

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
  repo = mkdtempSync(path.join(os.tmpdir(), 'claude-ui-gitstate-'));
  git('init', '-q');
  write('.gitignore', 'build/\n');
  write('src/a.txt', 'a\n');
  write('docs/b.txt', 'b\n');
  commit('first');
  return () => rmSync(repo, { recursive: true, force: true });
});

describe('workingTree', () => {
  it('is none outside a git working tree, and for a folder that is not there', async () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), 'claude-ui-plain-'));
    try {
      expect(await workingTree(plain)).toEqual({ kind: 'none' });
      expect(await workingTree(path.join(plain, 'gone'))).toEqual({ kind: 'none' });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('is none inside a repository’s .git, and failed, saying why, for a repository git cannot read', async () => {
    expect(await workingTree(path.join(repo, '.git'))).toEqual({ kind: 'none' });
    writeFileSync(path.join(repo, '.git', 'config'), '[core\n');
    expect(await workingTree(repo)).toEqual({ kind: 'failed', error: 'fatal: bad config line 1 in file .git/config' });
  });

  it('does not count a stash, whatever the config says about showing one', async () => {
    git('config', 'status.showStash', 'true');
    const clean = await fingerprint();
    write('src/a.txt', 'a, stashed\n');
    git('stash', '-q');
    expect(await fingerprint()).toBe(clean);
  });

  it('answers the same while nothing changes', async () => {
    expect(await fingerprint()).toBe(await fingerprint());
  });

  it('changes with an edit, and again with a second edit of a file already changed', async () => {
    const clean = await fingerprint();
    write('src/a.txt', 'a, edited\n');
    const edited = await fingerprint();
    expect(edited).not.toBe(clean);
    // The same size, so only the time tells it apart: git lists the file the same way both times.
    write('src/a.txt', 'a, EDITED\n');
    const later = new Date(statSync(path.join(repo, 'src/a.txt')).mtimeMs + 5000);
    utimesSync(path.join(repo, 'src/a.txt'), later, later);
    expect(await fingerprint()).not.toBe(edited);
  });

  it('changes with a new file in a new folder, and with an edit of it after', async () => {
    const clean = await fingerprint();
    write('src/new/c.txt', 'c\n');
    const added = await fingerprint();
    expect(added).not.toBe(clean);
    write('src/new/c.txt', 'c, longer\n');
    expect(await fingerprint()).not.toBe(added);
  });

  it('changes when a commit changes the folder, and not when one changes another folder only', async () => {
    const src = path.join(repo, 'src');
    const before = await fingerprint(src);
    write('docs/b.txt', 'b, edited\n');
    commit('docs only');
    expect(await fingerprint(src)).toBe(before);
    write('src/a.txt', 'a, edited\n');
    commit('src');
    expect(await fingerprint(src)).not.toBe(before);
  });

  it('does not change for a file git ignores', async () => {
    const clean = await fingerprint();
    write('build/out.txt', 'built\n');
    expect(await fingerprint()).toBe(clean);
  });

  it('does not write the index, which git status otherwise does after a change', async () => {
    write('src/a.txt', 'a, edited\n');
    const index = path.join(repo, '.git', 'index');
    const before = statSync(index).mtimeMs;
    await fingerprint();
    await fingerprint();
    expect(statSync(index).mtimeMs).toBe(before);
  });

  it('answers for a repository with no commit yet', async () => {
    const fresh = mkdtempSync(path.join(os.tmpdir(), 'claude-ui-fresh-'));
    try {
      execFileSync('git', ['-C', fresh, 'init', '-q']);
      const empty = await workingTree(fresh);
      writeFileSync(path.join(fresh, 'x.txt'), 'x\n');
      const one = await workingTree(fresh);
      expect(empty.kind).toBe('tree');
      expect(one).not.toEqual(empty);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe('statusPaths', () => {
  const status = (...records: string[]): Buffer => Buffer.from(records.map((record) => `${record}\0`).join(''));

  it('finds the path of every kind of record, spaces in it and all, and a renamed entry’s original', () => {
    expect(
      statusPaths(
        status(
          '1 .M N... 100644 100644 100644 abc abc src/a file.txt',
          '2 R. N... 100644 100644 100644 abc abc R100 src/new name.txt',
          'src/old name.txt',
          'u UU N... 100644 100644 100644 100644 abc abc abc src/both.txt',
          '? src/untracked file.txt',
        ),
      ).map(String),
    ).toEqual(['src/a file.txt', 'src/new name.txt', 'src/old name.txt', 'src/both.txt', 'src/untracked file.txt']);
  });

  it('lists nothing for a clean tree', () => {
    expect(statusPaths(Buffer.alloc(0))).toEqual([]);
  });
});
