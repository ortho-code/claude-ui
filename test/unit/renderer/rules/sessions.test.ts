import { describe, it, expect } from 'vitest';
import type { SessionCheckout } from '../../../../src/shared/types';
import {
  displayName,
  folderName,
  modelLabel,
  projectFor,
  projectGoneReason,
  projectRootExists,
  sameRow,
  sessionLabel,
  sessionsByKey,
  structuralSignature,
  unstartableReason,
  worktreeMarkState,
} from '../../../../src/renderer/rules/sessions';
import { session } from '../fixtures';

describe('unstartableReason', () => {
  it('says nothing about a session whose folder is there', () => {
    expect(unstartableReason(session())).toBeNull();
  });

  // The repo is fine and only the tree is gone, so the reason names the thing to put back — `git worktree add` at that path and the session works again.
  it('names the worktree when only the worktree is gone', () => {
    const gone = session({ cwd: '/repo/.claude/worktrees/wt', worktree: 'wt', cwdExists: false, repoRootExists: true });
    expect(unstartableReason(gone)).toContain('worktree “wt” is gone');
    expect(unstartableReason(gone)).toContain('/repo/.claude/worktrees/wt');
  });

  // The whole checkout is gone, so there is nothing smaller to point at.
  it('names the folder when the project itself is gone', () => {
    const gone = session({ cwd: '/gone', worktree: 'wt', cwdExists: false, repoRootExists: false });
    expect(unstartableReason(gone)).toBe("This session's folder is gone, so it cannot run: /gone");
  });

  it('treats a plain session with no worktree the same way', () => {
    expect(unstartableReason(session({ cwd: '/gone', cwdExists: false }))).toContain('/gone');
  });
});

describe('worktreeMarkState', () => {
  it('marks nothing for a session that never ran in a worktree', () => {
    expect(worktreeMarkState(session())).toBeNull();
  });

  it('names the worktree a session is in', () => {
    expect(worktreeMarkState(session({ worktree: 'wt' }))).toEqual({ muted: false, tooltip: 'Linked git worktree: wt', count: 0 });
  });

  // The session still did its work there, and the tooltip says which way it left and where a resume runs now.
  it('mutes the mark of a worktree the session was closed in, saying it closed there and where it resumes', () => {
    expect(worktreeMarkState(session({ cwd: '/repo', leftWorktree: 'wt' }))).toEqual({ muted: true, tooltip: 'Worked in linked git worktree: wt until it closed; resumes in /repo', count: 0 });
  });

  it('mutes the mark of a worktree the session moved out of, saying it moved and where it is now', () => {
    expect(worktreeMarkState(session({ cwd: '/repo', leftWorktree: 'wt', movedOutOfWorktree: true }))).toEqual({ muted: true, tooltip: 'Moved out of linked git worktree: wt; now in /repo', count: 0 });
  });

  const checkout = (root: string, own = false): SessionCheckout => ({ root, at: own ? '' : '2026-10-26T10:00:00.000Z', gone: false, own });

  // d90f859a: in the main checkout, its changes in worktrees it reached with a `cd`.
  it('marks a session that worked in worktrees it did not enter, in the accent while its panels follow it into one', () => {
    const checkouts = ['b', 'c', 'd'].map((name) => checkout(`/repo/.claude/worktrees/${name}`));
    expect(worktreeMarkState(session({ checkouts, workCwd: '/repo/.claude/worktrees/b' }))).toEqual({ muted: false, tooltip: 'Its panels follow it into linked git worktree: b; 3 checkouts it worked in', count: 3 });
    expect(worktreeMarkState(session({ checkouts }))).toEqual({ muted: true, tooltip: '3 checkouts it worked in', count: 3 });
  });

  // b11ed876: closed in its worktree, and changing files in it by path since.
  it('keeps the mark of a worktree the session left in the accent while its panels follow it there', () => {
    expect(worktreeMarkState(session({ cwd: '/repo', leftWorktree: 'wt', workCwd: '/repo/.claude/worktrees/wt' }))).toEqual({
      muted: false,
      tooltip: 'Worked in linked git worktree: wt until it closed; resumes in /repo; its panels follow it into linked git worktree: wt',
      count: 0,
    });
  });

  // 49ac1ff5: in a worktree, changing files in another and in the main checkout.
  it('counts the checkouts of a session in a worktree, its own among them, and names the main checkout when its panels follow it there', () => {
    const checkouts = [checkout('/repo'), checkout('/repo/.claude/worktrees/b'), checkout('/repo/.claude/worktrees/wt', true)];
    expect(worktreeMarkState(session({ cwd: '/repo/.claude/worktrees/wt', worktree: 'wt', checkouts, workCwd: '/repo' }))).toEqual({
      muted: false,
      tooltip: 'Linked git worktree: wt; its panels follow it into the main checkout; 3 checkouts it worked in',
      count: 3,
    });
  });
});

describe('projectRootExists', () => {
  it('holds while any session under the project still sees its folder', () => {
    expect(projectRootExists([session({ repoRootExists: false }), session({ repoRootExists: true })])).toBe(true);
  });

  it('fails only when every session says the folder is gone', () => {
    expect(projectRootExists([session({ repoRootExists: false }), session({ repoRootExists: false })])).toBe(false);
  });
});

describe('projectGoneReason', () => {
  it('names the folder that is gone', () => {
    expect(projectGoneReason('/gone')).toBe("This project's folder is gone, so nothing in it can run: /gone");
  });
});

describe('sessionsByKey', () => {
  it('indexes every session by its own id (ids are the stable entity key)', () => {
    const a = session({ id: 'a', conversationId: 'c', lastActivity: '2026-07-01T00:00:00.000Z' });
    const b = session({ id: 'b', conversationId: 'c', lastActivity: '2026-07-28T00:00:00.000Z' });
    const tips = sessionsByKey([a, b]);
    expect(tips.size).toBe(2);
    expect(tips.get('a')?.id).toBe('a');
    expect(tips.get('b')?.id).toBe('b');
  });
});

describe('structuralSignature', () => {
  it('is stable regardless of order and ignores activity', () => {
    const a = session({ id: 'a', conversationId: 'ca' });
    const b = session({ id: 'b', conversationId: 'cb' });
    const sigActivityChanged = session({ id: 'a', conversationId: 'ca', lastActivity: 'x' });
    expect(structuralSignature([a, b])).toBe(structuralSignature([b, a]));
    expect(structuralSignature([a])).toBe(structuralSignature([sigActivityChanged]));
  });

  it('changes when a title changes', () => {
    const a = session();
    expect(structuralSignature([a])).not.toBe(structuralSignature([session({ title: 'Renamed' })]));
  });

  /**
   * Every field a row is drawn from, one case each.
   * The sidebar is only redrawn when this string moves, so a field missing here is a row that FREEZES — it keeps the old value until something unrelated changes.
   * `model` is the one that was actually missing: switching model mid-session left the old label on the row.
   */
  it.each([
    ['model', { model: 'claude-opus-4' }],
    ['worktree', { worktree: 'feature-x' }],
    ['leftWorktree', { leftWorktree: 'feature-x' }],
    ['repoRoot', { repoRoot: '/elsewhere' }],
    ['isRepo', { isRepo: true }],
    ['cwd', { cwd: '/elsewhere' }],
    ['firstMessage', { firstMessage: 'hello' }],
    ['isSibling', { isSibling: true }],
    ['siblingIds', { siblingIds: ['other'] }],
    ['prs', { prs: [{ repository: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' }] }],
    ['id', { id: 'other' }],
    ['conversationId', { conversationId: 'other' }],
  ])('changes when %s changes', (_field, over) => {
    expect(structuralSignature([session()])).not.toBe(structuralSignature([session(over)]));
  });

  // A field holding objects: one swapped for another at the same count has to move it as well.
  it('changes when a PR is swapped for another', () => {
    const pr = (number: number) => ({ repository: 'o/r', number, url: `https://github.com/o/r/pull/${number}` });
    expect(structuralSignature([session({ prs: [pr(1)] })])).not.toBe(structuralSignature([session({ prs: [pr(2)] })]));
  });
  // The two that must NOT move it: one is rewritten on every message of a running session, the other is never drawn.
  it.each([
    ['lastActivity', { lastActivity: '2030-01-01T00:00:00Z' }],
    ['postCompactHeads', { postCompactHeads: ['head-1'] }],
  ])('ignores %s', (_field, over) => {
    expect(structuralSignature([session()])).toBe(structuralSignature([session(over)]));
  });
});

// The same fields, for one session against another summary of it: what an open tab asks of a fresh read.
describe('sameRow', () => {
  it('holds across a fresh summary that moved only what no row draws, and not across one that moved a drawn field', () => {
    expect(sameRow(session(), session({ lastActivity: '2030-01-01T00:00:00Z', postCompactHeads: ['head-1'] }))).toBe(true);
    expect(sameRow(session(), session({ title: 'Renamed' }))).toBe(false);
    expect(sameRow(session(), session({ cwdExists: false }))).toBe(false);
  });
});

describe('folderName', () => {
  it('names a project by the last path segment', () => {
    expect(folderName('/home/jille/development/scienta')).toBe('scienta');
    expect(folderName('scienta')).toBe('scienta');
  });
});

describe('projectFor', () => {
  const roots = ['/home/u/dev/scienta', '/home/u/dev/scienta/tools/dev-aws', '/home/u/dev/other'];

  it('finds the project a folder is, or the deepest one it sits under', () => {
    expect(projectFor(roots, '/home/u/dev/scienta')).toBe('/home/u/dev/scienta');
    expect(projectFor(roots, '/home/u/dev/scienta/packages/api')).toBe('/home/u/dev/scienta');
    expect(projectFor(roots, '/home/u/dev/scienta/tools/dev-aws/src')).toBe('/home/u/dev/scienta/tools/dev-aws');
  });

  it('does not take a folder whose name only starts the same, and finds nothing for a folder outside every project', () => {
    expect(projectFor(roots, '/home/u/dev/scienta-old')).toBeNull();
    expect(projectFor(roots, '/tmp')).toBeNull();
    expect(projectFor([], '/home/u/dev/scienta')).toBeNull();
  });
});

describe('modelLabel', () => {
  it('maps a model id to family + version, dropping the date', () => {
    expect(modelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('claude-fable-5')).toBe('Fable 5');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5'); // version-first id order
    expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4');
  });
  it('handles an unseen family generically (no hardcoded list)', () => {
    expect(modelLabel('claude-metis-6')).toBe('Metis 6');
  });
  it('falls back to the raw id with no family word, and empty in -> empty out', () => {
    expect(modelLabel('claude-2099')).toBe('claude-2099');
    expect(modelLabel('')).toBe('');
  });
});

describe('displayName', () => {
  it('uses the rename override when present, else the folder name', () => {
    const names = new Map([['/x/alpha', 'My Project']]);
    expect(displayName('/x/alpha', names)).toBe('My Project');
    expect(displayName('/x/beta', names)).toBe('beta');
    expect(displayName('/x/beta')).toBe('beta'); // no map at all
    expect(displayName('/x/alpha', new Map([['/x/alpha', '']]))).toBe('alpha'); // blank falls back
  });
});

describe('sessionLabel', () => {
  it("names a session by Claude's title, else its first prompt, else as new in its folder", () => {
    expect(sessionLabel(session({ title: 'Fix the login', firstMessage: 'the login is broken', cwd: '/x/demo' }))).toBe('Fix the login');
    expect(sessionLabel(session({ title: '', firstMessage: 'the login is broken', cwd: '/x/demo' }))).toBe('the login is broken');
    expect(sessionLabel(session({ title: '', firstMessage: '', cwd: '/x/demo' }))).toBe('New: demo');
  });
});

describe('sessionsByKey with siblings', () => {
  it('keeps every session as its own tip, siblings and lone alike', () => {
    const lone = session({ id: 'lone', conversationId: 'L', lastActivity: '2026-01-01' });
    const s1 = session({ id: 's1', conversationId: 'C', isSibling: true, siblingIds: ['s2'], lastActivity: '2026-01-03' });
    const s2 = session({ id: 's2', conversationId: 'C', isSibling: true, siblingIds: ['s1'], lastActivity: '2026-01-02' });
    const tips = sessionsByKey([lone, s1, s2]);
    expect(tips.size).toBe(3);
    expect(tips.get('lone')?.id).toBe('lone');
    expect(tips.get('s1')?.id).toBe('s1');
    expect(tips.get('s2')?.id).toBe('s2');
  });
});
