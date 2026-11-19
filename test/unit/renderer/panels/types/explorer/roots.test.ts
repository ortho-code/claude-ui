import { describe, expect, it } from 'vitest';
import { explorerRoots } from '../../../../../../src/renderer/panels/types/explorer/roots';
import type { SessionCheckout } from '../../../../../../src/shared/types';

const MAIN = '/repo';
const FIX = '/repo/.claude/worktrees/fix';
const OLD = '/repo/.claude/worktrees/old';

const checkout = (root: string, over: Partial<SessionCheckout> = {}): SessionCheckout => ({ root, at: '2026-11-19T08:00:00.000Z', gone: false, own: false, ...over });
const session = (checkouts: SessionCheckout[], isRepo = true) => ({ repoRoot: MAIN, isRepo, checkouts });

describe('explorerRoots', () => {
  it('puts the checkout the panel looks in first, then the session’s other checkouts as its record lists them', () => {
    const roots = explorerRoots(FIX, FIX, session([checkout(FIX), checkout(OLD), checkout(MAIN)]), []);
    expect(roots.map((root) => [root.path, root.reason, root.folded])).toEqual([
      [FIX, 'works', false],
      [OLD, 'checkout', false],
      [MAIN, 'checkout', false],
    ]);
  });

  it('adds the main checkout last, folded, when the session changed nothing there', () => {
    expect(explorerRoots(FIX, FIX, session([]), []).map((root) => [root.path, root.reason, root.folded])).toEqual([
      [FIX, 'works', false],
      [MAIN, 'shared', true],
    ]);
  });

  it('folds a checkout its record lists with no change, and leaves out one whose folder is gone', () => {
    const roots = explorerRoots(MAIN, MAIN, session([checkout(OLD, { at: '', own: true }), checkout(FIX, { gone: true })]), []);
    expect(roots.map((root) => [root.path, root.folded])).toEqual([
      [MAIN, false],
      [OLD, true],
    ]);
  });

  it('has the panel’s own folder alone with no session, and for a session outside every repository', () => {
    expect(explorerRoots('/elsewhere', '/elsewhere', null, []).map((root) => root.path)).toEqual(['/elsewhere']);
    expect(explorerRoots('/notes', '/notes', session([], false), []).map((root) => root.path)).toEqual(['/notes']);
  });

  it('puts the repositories inside the folder after the first root, named by their path from it, folded when they list no change', () => {
    const roots = explorerRoots(MAIN, MAIN, session([]), [
      { path: `${MAIN}/libs/clone`, changed: true },
      { path: `${MAIN}/tools/quiet`, changed: false },
    ]);
    expect(roots.map((root) => [root.name, root.reason, root.folded])).toEqual([
      ['repo', 'works', false],
      ['libs/clone', 'nested', false],
      ['tools/quiet', 'nested', true],
    ]);
  });

  it('has the repositories inside a folder no repository holds as its only roots', () => {
    const roots = explorerRoots(null, '/site', session([], false), [{ path: '/site/wp-content/themes/theme', changed: true }]);
    expect(roots.map((root) => [root.name, root.reason])).toEqual([['wp-content/themes/theme', 'nested']]);
  });
});
