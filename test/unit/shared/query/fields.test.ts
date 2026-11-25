import { describe, it, expect } from 'vitest';

import { matches } from '../../../../src/shared/query/evaluate';
import type { PrState, QueryFacts } from '../../../../src/shared/query/facts';
import { coreFields } from '../../../../src/shared/query/fields';
import { parseQuery } from '../../../../src/shared/query/parse';
import type { SessionSummary } from '../../../../src/shared/types';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';
import { session } from '../../renderer/fixtures';
import { ago, facts, NOW, only } from './facts';

const fields = coreFields(bundledNeedsYou());

const a = session({ id: 'a', title: 'a' });
const b = session({ id: 'b', title: 'b' });

/** The ids of the sessions a query holds, of `sessions`, which every query here reads. */
function found(text: string, known: Partial<QueryFacts> = {}, sessions: readonly SessionSummary[] = [a, b]): string[] {
  const query = parseQuery(text, fields.fields);
  expect(query.problems).toEqual([]);
  return sessions.filter((each) => matches(each, query, fields, facts(known))).map((each) => each.id);
}

const pr = (number: number, repository = 'acme/app'): SessionSummary['prs'][number] => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });
const statesBy = (byNumber: Record<number, PrState[]>) => (each: SessionSummary['prs'][number]): ReadonlySet<PrState> => new Set(byNumber[each.number] ?? []);

describe('is:', () => {
  it('holds each state for the session in it', () => {
    expect(found('is:working', { tabbed: only('a') })).toEqual(['a']);
    expect(found('is:running', { running: only('a') })).toEqual(['a']);
    expect(found('is:set-aside', { setAside: (s) => (s.id === 'a' ? { due: null, at: 1 } : undefined) })).toEqual(['a']);
    expect(found('is:pinned', { pinned: only('a') })).toEqual(['a']);
    expect(found('is:worktree', { worktree: only('a') })).toEqual(['a']);
    expect(found('is:gone', { gone: only('a') })).toEqual(['a']);
    expect(found('is:sibling', {}, [session({ id: 'a', isSibling: true }), b])).toEqual(['a']);
  });

  it('holds unfinished for a session with no tab, not finished and not on its way to the trash', () => {
    const c = session({ id: 'c' });
    const d = session({ id: 'd' });
    expect(found('is:unfinished', { tabbed: only('a'), finished: only('b'), deleting: only('c') }, [a, b, c, d])).toEqual(['d']);
  });

  it('holds ready-to-finish where every PR linked is merged or closed, and none where one is open, unknown or none is linked', () => {
    const settled = session({ id: 'settled', prs: [pr(1), pr(2)] });
    const open = session({ id: 'open', prs: [pr(1), pr(3)] });
    const unknown = session({ id: 'unknown', prs: [pr(1), pr(9)] });
    const none = session({ id: 'none' });
    expect(found('is:ready-to-finish', { prStates: statesBy({ 1: ['merged'], 2: ['closed'], 3: ['open'] }) }, [settled, open, unknown, none])).toEqual(['settled']);
  });
});

describe('has:, status: and needs:', () => {
  it('holds has: for a PR linked and a note kept', () => {
    expect(found('has:pr', {}, [session({ id: 'a', prs: [pr(1)] }), b])).toEqual(['a']);
    expect(found('has:note', { note: (s) => (s.id === 'a' ? 'why' : undefined) })).toEqual(['a']);
  });

  it("holds status: for what the session's claude is doing", () => {
    expect(found('status:waiting', { status: (s) => (s.id === 'a' ? 'waiting' : 'busy') })).toEqual(['a']);
  });

  it("holds needs: for any reason, a type or its category, claude's own ask counted as its type", () => {
    const merged = { reasons: (s: SessionSummary) => (s.id === 'a' ? [{ type: 'pr.merged' as const, at: 1, pr: 'acme/app#1' }] : []) };
    expect(found('needs:any', merged)).toEqual(['a']);
    expect(found('needs:pr.merged', merged)).toEqual(['a']);
    expect(found('needs:finish-up', merged)).toEqual(['a']);
    expect(found('needs:your-turn', merged)).toEqual([]);
    const asks = { claudeAsks: (s: SessionSummary) => (s.id === 'b' ? ('claude.asks' as const) : null) };
    expect(found('needs:any', asks)).toEqual(['b']);
    expect(found('needs:your-turn', asks)).toEqual(['b']);
  });
});

describe('names', () => {
  it('holds project:, group: and title: where the name contains the value, without regard to capitals', () => {
    const named = [session({ id: 'a', repoRoot: '/work/Claude-UI', title: 'Fix the Login' }), session({ id: 'b', repoRoot: '/work/other', title: 'other' })];
    expect(found('project:claude', {}, named)).toEqual(['a']);
    expect(found('title:login', {}, named)).toEqual(['a']);
    expect(found('group:"code rev"', { groupName: (s) => (s.id === 'a' ? 'Code reviews' : 'Elsewhere') }, named)).toEqual(['a']);
  });
});

describe('moments', () => {
  it('holds active: counted in whole days from midnight, so a session active 30 days ago to the hour is not yet before today-30d', () => {
    const old = session({ id: 'old', lastActivity: ago(31) });
    const edge = session({ id: 'edge', lastActivity: ago(30) });
    const fresh = session({ id: 'fresh', lastActivity: ago(1) });
    expect(found('active:<today-30d', {}, [old, edge, fresh])).toEqual(['old']);
    expect(found('active:>=today-7d', {}, [old, edge, fresh])).toEqual(['fresh']);
  });

  it('works the day out again when the time it is asked at moves to another day', () => {
    const edge = session({ id: 'edge', lastActivity: ago(30) });
    expect(found('active:<today-30d', {}, [edge])).toEqual([]);
    expect(found('active:<today-30d', { now: NOW + 86_400_000 }, [edge])).toEqual(['edge']);
  });

  it('holds kept: and due: only for a session that has that moment', () => {
    expect(found('kept:>=today-30d', { kept: (s) => (s.id === 'a' ? NOW - 86_400_000 : undefined) })).toEqual(['a']);
    expect(found('due:tomorrow', { setAside: (s) => (s.id === 'a' ? { due: NOW + 86_400_000, at: 1 } : { due: null, at: 1 }) })).toEqual(['a']);
  });
});

describe('pr: and pr.state:', () => {
  const mine = session({ id: 'a', prs: [pr(12, 'Acme/App')] });
  const theirs = session({ id: 'b', prs: [pr(34)] });
  const known = { prRole: (each: SessionSummary['prs'][number]) => (each.number === 12 ? ('own' as const) : ('reviewing' as const)), prStates: statesBy({ 12: ['open', 'approved'], 34: ['open', 'checks-failed'] }) };

  it('holds pr: by your role, by number, and by reference without regard to the capitals of its repository', () => {
    expect(found('pr:own', known, [mine, theirs])).toEqual(['a']);
    expect(found('pr:34', known, [mine, theirs])).toEqual(['b']);
    expect(found('pr:acme/app#12', known, [mine, theirs])).toEqual(['a']);
  });

  it('holds pr.state: for a PR in any of the states named', () => {
    expect(found('pr.state:approved', known, [mine, theirs])).toEqual(['a']);
    expect(found('pr.state:merged,checks-failed', known, [mine, theirs])).toEqual(['b']);
  });
});

describe('free words', () => {
  const titled = session({ id: 'a', title: 'login page', firstMessage: 'fix it', cwd: '/work/app' });
  const joined = session({ id: 'b', title: 'quick fix', firstMessage: 'login later' });

  it('holds each word in one text of any source, so words need not stand together', () => {
    expect(found('fix login', {}, [titled, joined])).toEqual(['a', 'b']);
  });

  it('holds a quoted phrase only where one text has it whole, never across two texts', () => {
    expect(found('"fix login"', {}, [titled, joined])).toEqual([]);
    expect(found('"login page"', {}, [titled, joined])).toEqual(['a']);
  });

  it("holds a word in a session's id only from the id's start or its end, without regard to capitals", () => {
    const idOf = session({ id: '563e7e99-2908-4b2b-adf6-544b4e30cb41', title: 'x', firstMessage: '', cwd: '/w' });
    expect(found('563E7E99', {}, [idOf])).toEqual([idOf.id]);
    expect(found('4E30CB41', {}, [idOf])).toEqual([idOf.id]);
    expect(found(idOf.id, {}, [idOf])).toEqual([idOf.id]);
    expect(found('2908', {}, [idOf])).toEqual([]);
  });

  it("holds a phrase never across a PR's reference and its title, which are texts of their own", () => {
    const linked = session({ id: 'a', prs: [pr(12)] });
    const titled = { prTitle: () => 'Fix the tick' };
    expect(found('"#12 Fix"', titled, [linked, b])).toEqual([]);
    expect(found('"Fix the"', titled, [linked, b])).toEqual(['a']);
  });

  it("holds a word in the note, the group's name, the folder and a PR's number or title", () => {
    expect(found('why', { note: (s) => (s.id === 'a' ? 'why so' : undefined) })).toEqual(['a']);
    expect(found('shelf', { groupName: (s) => (s.id === 'b' ? 'Shelf' : undefined) })).toEqual(['b']);
    expect(found('work/app', {}, [titled, joined])).toEqual(['a']);
    const linked = session({ id: 'a', prs: [pr(36773)] });
    expect(found('36773', {}, [linked, b])).toEqual(['a']);
    expect(found('scheduler', { prTitle: (each) => (each.number === 36773 ? 'Scheduler tick' : undefined) }, [linked, b])).toEqual(['a']);
  });
});

describe('the query', () => {
  it('holds every session for an empty query', () => {
    expect(found('')).toEqual(['a', 'b']);
  });

  it('holds an OR across kinds of filter, a NOT, and the two combined', () => {
    const c = session({ id: 'c' });
    const known = { pinned: only('a'), running: only('b', 'c'), setAside: (s: SessionSummary) => (s.id === 'c' ? { due: null, at: 1 } : undefined) };
    expect(found('is:pinned OR is:running', known, [a, b, c])).toEqual(['a', 'b', 'c']);
    expect(found('-is:pinned', known, [a, b, c])).toEqual(['b', 'c']);
    expect(found('-is:running is:pinned OR is:set-aside', known, [a, b, c])).toEqual(['a', 'c']);
  });
});
