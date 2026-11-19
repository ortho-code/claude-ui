import { describe, expect, it, vi } from 'vitest';
import { useMetaDir } from '../sessions/meta-fixture';
import { commit, git, remoteBranch, repo, useRepo, write } from './repo-fixture';

vi.mock('electron', async () => (await import('../sessions/meta-fixture')).electronStub);

const { diffCommits, diffSummary, fileDiff } = await import('../../../../src/main/diff/read');

useMetaDir();
useRepo();

/** A repository whose `upstream/main` is its first commit, with the branch's work on top of it. */
function branched(files: Record<string, string>): string {
  for (const [file, text] of Object.entries(files)) write(file, text);
  const base = commit('base');
  remoteBranch('upstream/main', base);
  return base;
}

describe('the summary', () => {
  it('lists committed and uncommitted changes since the branch left its base, untracked files after them', async () => {
    const base = branched({ 'a.txt': 'one\n', 'b.txt': 'two\n' });
    write('a.txt', 'one\nmore\n');
    commit('edit a');
    write('b.txt', 'changed\n');
    write('new.txt', 'fresh\n');
    const summary = await diffSummary(repo(), 'since');
    expect(summary.against).toBe(base);
    expect(summary.root).toBe(git('rev-parse', '--show-toplevel'));
    expect(summary.files.map((f) => [f.path, f.status, f.added, f.deleted])).toEqual([
      ['a.txt', 'M', 1, 0],
      ['b.txt', 'M', 1, 1],
      ['new.txt', 'U', 0, 0],
    ]);
  });

  it('names the branch the checkout has out, and none for a detached HEAD', async () => {
    const base = branched({ 'a.txt': 'one\n' });
    git('checkout', '-q', '-b', 'topic');
    expect((await diffSummary(repo(), 'uncommitted')).branch).toBe('topic');
    git('checkout', '-q', '--detach', base);
    expect((await diffSummary(repo(), 'uncommitted')).branch).toBeNull();
  });

  it('lists only what is not committed for Uncommitted', async () => {
    branched({ 'a.txt': 'one\n', 'b.txt': 'two\n' });
    write('a.txt', 'one\nmore\n');
    commit('edit a');
    write('b.txt', 'changed\n');
    expect((await diffSummary(repo(), 'uncommitted')).files.map((f) => f.path)).toEqual(['b.txt']);
  });

  it('keeps a rename as one row with its old path', async () => {
    branched({ 'old/name.txt': 'line one\nline two\nline three\n', 'new/keep.txt': 'x\n' });
    git('mv', 'old/name.txt', 'new/name.txt');
    commit('move');
    const [file] = (await diffSummary(repo(), 'since')).files;
    expect(file).toMatchObject({ path: 'new/name.txt', from: 'old/name.txt', status: 'R' });
  });

  it('marks a binary file, a lockfile by name, and an attribute that says otherwise', async () => {
    branched({ '.gitattributes': 'yarn.lock linguist-generated=false\nbuild.js linguist-generated\n' });
    write('image.bin', Buffer.from([0, 1, 2, 0]).toString('latin1'));
    write('package-lock.json', '{}\n');
    write('yarn.lock', 'x\n');
    write('build.js', 'x\n');
    commit('add');
    const byPath = Object.fromEntries((await diffSummary(repo(), 'since')).files.map((f) => [f.path, f]));
    expect(byPath['image.bin'].binary).toBe(true);
    expect(byPath['package-lock.json'].generated).toBe(true);
    expect(byPath['yarn.lock'].generated).toBe(false);
    expect(byPath['build.js'].generated).toBe(true);
  });

  it('covers the whole checkout from a subfolder, with paths from its root', async () => {
    branched({ 'top.txt': 'one\n', 'sub/inner.txt': 'two\n' });
    write('top.txt', 'changed\n');
    const summary = await diffSummary(`${repo()}/sub`, 'uncommitted');
    expect(summary.files.map((f) => f.path)).toEqual(['top.txt']);
  });

  it('has nothing to list for Since branched without a base, and says so by naming none', async () => {
    write('a.txt', 'one\n');
    commit('root');
    write('a.txt', 'two\n');
    expect(await diffSummary(repo(), 'since')).toMatchObject({ against: null, base: null, files: [] });
  });
});

describe('a file', () => {
  it('gives each row its line numbers and marks the words that changed in an equal pair', async () => {
    const base = branched({ 'a.txt': 'keep\nthe old word\nkeep\n' });
    write('a.txt', 'keep\nthe new word\nkeep\n');
    const file = await fileDiff(repo(), base, 'a.txt', null, 3, false);
    const changed = file.hunks[0].rows.filter((row) => row.kind !== 'context');
    expect(changed).toEqual([
      { kind: 'del', old: 2, new: null, text: 'the old word', words: [[4, 7]] },
      { kind: 'add', old: null, new: 2, text: 'the new word', words: [[4, 7]] },
    ]);
    expect(file.lines).toEqual(['keep', 'the new word', 'keep']);
  });

  it('reads a renamed file against its old path, so it is not all added', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line number ${i + 1}`);
    const base = branched({ 'old.txt': `${lines.join('\n')}\n` });
    git('mv', 'old.txt', 'new.txt');
    write('new.txt', `${[...lines.slice(0, -1), 'changed'].join('\n')}\n`);
    git('add', '-A');
    const file = await fileDiff(repo(), base, 'new.txt', 'old.txt', 3, false);
    expect(file.hunks.flatMap((hunk) => hunk.rows).filter((row) => row.kind !== 'context').map((row) => [row.kind, row.text])).toEqual([
      ['del', 'line number 20'],
      ['add', 'changed'],
    ]);
  });

  it('reads only the asked file when git does not pair a rename, rather than mixing in the old path', async () => {
    const base = branched({ 'old.txt': 'a\nb\n' });
    git('mv', 'old.txt', 'new.txt');
    write('new.txt', 'entirely\nother\ncontent\n');
    git('add', '-A');
    const file = await fileDiff(repo(), base, 'new.txt', 'old.txt', 3, false);
    expect(file.hunks.flatMap((hunk) => hunk.rows).map((row) => [row.kind, row.text])).toEqual([
      ['add', 'entirely'],
      ['add', 'other'],
      ['add', 'content'],
    ]);
  });

  it('reads an untracked file as added from nothing', async () => {
    const base = branched({ 'a.txt': 'one\n' });
    write('fresh.txt', 'first\nsecond\n');
    const file = await fileDiff(repo(), base, 'fresh.txt', null, 3, false);
    expect(file.hunks[0].rows.map((row) => [row.kind, row.text])).toEqual([
      ['add', 'first'],
      ['add', 'second'],
    ]);
  });

  it('leaves a whitespace-only change out when asked', async () => {
    const base = branched({ 'a.txt': 'if (x) {\n  y();\n}\n' });
    write('a.txt', 'if (x) {\n    y();\n}\n');
    expect((await fileDiff(repo(), base, 'a.txt', null, 3, false)).hunks).toHaveLength(1);
    expect((await fileDiff(repo(), base, 'a.txt', null, 3, true)).hunks).toHaveLength(0);
  });
});

describe('the commits', () => {
  it('lists the commits since the base, newest first, without merges', async () => {
    const base = branched({ 'a.txt': 'one\n' });
    commit('first');
    commit('second');
    expect((await diffCommits(repo(), base)).map((c) => c.subject)).toEqual(['second', 'first']);
  });
});
