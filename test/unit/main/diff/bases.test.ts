import { describe, expect, it, vi } from 'vitest';
import { useMetaDir } from '../sessions/meta-fixture';
import { commit, git, remoteBranch, remoteDefault, repo, useRepo } from './repo-fixture';

vi.mock('electron', async () => (await import('../sessions/meta-fixture')).electronStub);

const { againstOf, baseCount, baseOf, candidates, conventionBase, countsOf } = await import('../../../../src/main/diff/bases');

/** The empty tree as git names it in the test's repository. */
const emptyTree = (): string => git('hash-object', '-t', 'tree', '/dev/null');
const { keepBase } = await import('../../../../src/main/sessions/diff-bases');

useMetaDir();
useRepo();

/** A fork as a clone of one leaves it: `origin` the person's fork, far behind, named its default; `upstream` the original, current; a branch with two commits of its own on top. */
function fork(): { old: string; current: string; head: string } {
  const old = commit('old base');
  const current = commit('current base');
  remoteBranch('origin/develop', old);
  remoteDefault('origin/develop');
  remoteBranch('upstream/develop', current);
  git('checkout', '-q', '-b', 'feature');
  commit('own one');
  const head = commit('own two');
  return { old, current, head };
}

describe('the convention base', () => {
  it('takes upstream before origin, so a fork measures from its original rather than a stale copy', async () => {
    fork();
    expect(await conventionBase(repo())).toBe('upstream/develop');
  });

  it('takes a remote default git names over the mainline names', async () => {
    const sha = commit('one');
    remoteBranch('origin/develop', sha);
    remoteBranch('origin/trunk', sha);
    remoteDefault('origin/trunk');
    expect(await conventionBase(repo())).toBe('origin/trunk');
  });

  it('is none without a remote branch', async () => {
    commit('one');
    expect(await conventionBase(repo())).toBeNull();
  });
});

describe('the candidates', () => {
  it('lists every remote branch once, the remote HEAD itself left out, marking the defaults', async () => {
    fork();
    expect(await candidates(repo())).toEqual([
      { ref: 'origin/develop', isDefault: true },
      { ref: 'upstream/develop', isDefault: false },
    ]);
  });
});

describe('the base, layer by layer', () => {
  it('is the convention guess with nothing kept', async () => {
    fork();
    expect(await baseOf(repo())).toEqual({ base: { ref: 'upstream/develop', source: 'convention' }, missing: null });
  });

  it("is the project's over the convention, and the branch's over the project's", async () => {
    fork();
    await keepBase(repo(), null, 'origin/develop');
    expect((await baseOf(repo())).base).toEqual({ ref: 'origin/develop', source: 'project' });
    await keepBase(repo(), 'feature', 'upstream/develop');
    expect((await baseOf(repo())).base).toEqual({ ref: 'upstream/develop', source: 'branch' });
  });

  it("does not take another branch's pick", async () => {
    fork();
    await keepBase(repo(), 'other', 'origin/develop');
    expect((await baseOf(repo())).base?.source).toBe('convention');
  });

  it('gives way when a kept base no longer resolves, and names it', async () => {
    fork();
    await keepBase(repo(), 'feature', 'upstream/gone');
    expect(await baseOf(repo())).toEqual({ base: { ref: 'upstream/develop', source: 'convention' }, missing: 'upstream/gone' });
  });
});

describe('what each question is taken against', () => {
  it('is the merge-base for Since branched, not the base tip', async () => {
    const { current } = fork();
    commit('none');
    remoteBranch('upstream/develop', git('commit-tree', '-p', current, '-m', 'upstream moved on', `${current}^{tree}`));
    const { base } = await baseOf(repo());
    expect(await againstOf(repo(), 'since', base)).toBe(current);
  });

  it('is the parent of the oldest unpushed commit for Unpushed', async () => {
    const { current } = fork();
    expect(await againstOf(repo(), 'unpushed', null)).toBe(current);
  });

  it('is HEAD for Unpushed when every commit is on a remote, and for Uncommitted', async () => {
    const { head } = fork();
    remoteBranch('origin/feature', head);
    expect(await againstOf(repo(), 'unpushed', null)).toBe(head);
    expect(await againstOf(repo(), 'uncommitted', null)).toBe(head);
  });

  it('is the empty tree for Unpushed when no commit has gone out', async () => {
    commit('root');
    expect(await againstOf(repo(), 'unpushed', null)).toBe(emptyTree());
  });

  it("is the empty tree of the repository's own object format", async () => {
    git('init', '-q', '--object-format=sha256', 'sha256');
    const sha256 = `${repo()}/sha256`;
    const tree = await againstOf(sha256, 'uncommitted', null);
    expect(tree).toHaveLength(64);
    expect(tree).not.toBe(emptyTree());
  });

  it('is nothing for Since branched without a base', async () => {
    commit('root');
    expect(await againstOf(repo(), 'since', null)).toBeNull();
  });

  it('is the empty tree for Uncommitted on a branch with no commit yet', async () => {
    expect(await againstOf(repo(), 'uncommitted', null)).toBe(emptyTree());
  });
});

describe('the counts', () => {
  it('counts ahead and behind the base, and the unpushed commits', async () => {
    fork();
    const { base } = await baseOf(repo());
    expect(await countsOf(repo(), base)).toEqual({ ahead: 2, behind: 0, unpushed: 2 });
  });

  it('counts what a candidate base would make the branch its own', async () => {
    fork();
    expect(await baseCount(repo(), 'upstream/develop')).toBe(2);
    expect(await baseCount(repo(), 'origin/develop')).toBe(3);
  });

  it('counts nothing for a base with no history in common', async () => {
    fork();
    remoteBranch('other/main', git('commit-tree', '-m', 'unrelated', git('hash-object', '-w', '-t', 'tree', '/dev/null')));
    expect(await baseCount(repo(), 'other/main')).toBeNull();
  });
});
