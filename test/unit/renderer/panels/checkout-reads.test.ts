import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutReads, type ChangesBridge, type ChangesRead } from '../../../../src/renderer/panels/checkout-reads';
import { POLL_MS } from '../../../../src/renderer/panels/tree-watch';
import type { DiffSummary } from '../../../../src/shared/diff/types';

const ROOT = '/repo';

/** A summary of `root` listing `paths`, as main answers a read of it. */
const summary = (paths: string[], root = ROOT): ChangesRead => ({
  kind: 'summary',
  summary: { root, files: paths.map((path) => ({ path, from: null, status: 'M', added: 1, deleted: 0, binary: false, generated: false })) } as unknown as DiffSummary,
});

/** A bridge whose tree and answers the test sets, counting what it is asked. */
function bridge() {
  const state = { fingerprint: 'a', files: ['a.ts'], reads: 0, looks: 0 };
  const fake: ChangesBridge = {
    diffSummary: (dir) => {
      state.reads++;
      return Promise.resolve(summary(state.files, dir.startsWith(ROOT) ? ROOT : dir));
    },
    panelTree: () => {
      state.looks++;
      return Promise.resolve({ kind: 'tree', fingerprint: state.fingerprint });
    },
  };
  return { reads: new CheckoutReads(() => fake), state };
}

/** Let the reads' promises settle. */
const settled = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('CheckoutReads', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tells every follower of a checkout and question one read, asked once', async () => {
    const { reads, state } = bridge();
    const heard: string[] = [];
    reads.follow(ROOT, 'since', () => heard.push('first'));
    reads.follow(ROOT, 'since', () => heard.push('second'));
    reads.follow(ROOT, 'uncommitted', () => heard.push('other question'));
    await Promise.all([reads.read(ROOT, 'since'), reads.read(ROOT, 'since')]);
    expect(state.reads).toBe(1);
    expect(heard).toEqual(['first', 'second']);
  });

  it('tells a read asked from a folder inside the checkout to the followers of its root', async () => {
    const { reads } = bridge();
    const heard: ChangesRead[] = [];
    reads.follow(ROOT, 'since', (read) => heard.push(read));
    const read = await reads.read(`${ROOT}/src`, 'since');
    expect(heard).toEqual([read]);
  });

  it('tells a follower nothing when a read says what it was told last', async () => {
    const { reads, state } = bridge();
    const heard: string[][] = [];
    reads.follow(ROOT, 'since', (read) => heard.push(read.kind === 'summary' ? read.summary.files.map((file) => file.path) : []));
    await reads.read(ROOT, 'since');
    await reads.read(ROOT, 'since');
    state.files = ['a.ts', 'b.ts'];
    await reads.read(ROOT, 'since');
    expect(heard).toEqual([['a.ts'], ['a.ts', 'b.ts']]);
  });

  it('tells a follower a read that lists the same files when the tree has changed since, as a file edited again does', async () => {
    const { reads, state } = bridge();
    let heard = 0;
    reads.follow(ROOT, 'since', () => heard++);
    await reads.read(ROOT, 'since');
    state.fingerprint = 'b';
    await reads.read(ROOT, 'since');
    expect(heard).toBe(2);
  });

  it('reads another followed question again when a read of one finds the tree changed since that one was read', async () => {
    const { reads, state } = bridge();
    const heard: number[] = [];
    reads.follow(ROOT, 'since', (read) => heard.push(read.kind === 'summary' ? read.summary.files.length : 0));
    reads.follow(ROOT, 'uncommitted', () => {});
    await reads.read(ROOT, 'since');
    await reads.read(ROOT, 'uncommitted');
    await settled();
    expect(heard).toEqual([1]);
    state.fingerprint = 'b';
    state.files = ['a.ts', 'b.ts'];
    await reads.read(ROOT, 'uncommitted');
    await settled();
    expect(heard).toEqual([1, 2]);
  });

  it('reads the checkout again for each question followed once the tree has changed for two looks, and not for one', async () => {
    const { reads, state } = bridge();
    const heard: string[] = [];
    reads.follow(ROOT, 'since', (read) => heard.push(`since ${read.kind === 'summary' ? read.summary.files.length : 0}`));
    reads.follow(ROOT, 'uncommitted', (read) => heard.push(`uncommitted ${read.kind === 'summary' ? read.summary.files.length : 0}`));
    await settled();
    state.fingerprint = 'b';
    state.files = ['a.ts', 'b.ts'];
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(state.reads).toBe(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(state.reads).toBe(2);
    expect(heard.sort()).toEqual(['since 2', 'uncommitted 2']);
  });

  it('stops watching the checkout once its last follower stops, and not before', async () => {
    const { reads, state } = bridge();
    const stopFirst = reads.follow(ROOT, 'since', () => {});
    const stopSecond = reads.follow(ROOT, 'since', () => {});
    await settled();
    stopFirst();
    const before = state.looks;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(state.looks).toBe(before + 1);
    stopSecond();
    expect(vi.getTimerCount()).toBe(0);
  });
});
