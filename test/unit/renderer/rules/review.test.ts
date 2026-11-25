import { describe, expect, it } from 'vitest';
import type { PrState, QueryFacts } from '../../../../src/shared/query/facts';
import { coreFields } from '../../../../src/shared/query/fields';
import type { SessionSummary } from '../../../../src/shared/types';
import { readyNote, REVIEW, reviewCount, reviewSections, type ReadyFacts } from '../../../../src/renderer/rules/review';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';
import { ago, facts, NOW, only } from '../../shared/query/facts';
import { session as fixture } from '../fixtures';

const DAY = 86_400_000;
const fields = coreFields(bundledNeedsYou());

function session(id: string, days: number, prs: number[] = []): SessionSummary {
  return fixture({ id, title: id, lastActivity: ago(days), prs: prs.map((number) => ({ repository: 'acme/app', number, url: `https://github.com/acme/app/pull/${number}` })) });
}

const STATES: Record<number, PrState[]> = { 1: ['merged'], 2: ['closed'], 3: ['open'] };
const known = (over: Partial<QueryFacts> = {}): QueryFacts => facts({ prStates: (pr) => new Set(STATES[pr.number] ?? []), ...over });
const ready: ReadyFacts = { prStatus: { statuses: { 'acme/app#1': { state: 'merged', role: 'own' } }, problem: null }, prStatusOn: true };

const sections = (sessions: SessionSummary[], over: Partial<QueryFacts> = {}): ReturnType<typeof reviewSections> => reviewSections(sessions, fields, known(over), ready);
const ids = (shown: ReturnType<typeof reviewSections>): string[][] => shown.map((section) => section.rows.map((row) => row.id));

describe('the definition', () => {
  it('holds both numbers of days, 30, in its queries', () => {
    expect(REVIEW.shared).toBe('is:unfinished -is:set-aside -kept:>=today-30d');
    expect(REVIEW.sections.map((set) => set.query)).toEqual(['is:ready-to-finish', 'active:<today-30d']);
  });
});

describe('the sets', () => {
  const readyRow = session('ready', 2, [1]);
  const old = session('old', 40);
  const both = session('both', 50, [1, 2]);
  const fresh = session('fresh', 3);

  it('hold the ready and the untouched, oldest first, one in both shown once under Ready to finish', () => {
    const shown = sections([fresh, readyRow, old, both]);
    expect(shown.map((section) => section.name)).toEqual(['Ready to finish', 'Untouched 30+ days']);
    expect(ids(shown)).toEqual([['both', 'ready'], ['old']]);
    expect(reviewCount(shown)).toBe(3);
  });

  it('leave out a session with a tab, finished, set aside, or kept within its days, from both sets', () => {
    expect(ids(sections([readyRow, old], { tabbed: only('ready'), setAside: (s) => (s.id === 'old' ? { due: null, at: 1 } : undefined) }))).toEqual([[], []]);
    expect(ids(sections([readyRow, old], { kept: () => NOW - DAY }))).toEqual([[], []]);
    expect(ids(sections([readyRow, old], { finished: only('ready', 'old') }))).toEqual([[], []]);
  });

  it('count their days in whole days from midnight: a session untouched 30 days to the hour joins tomorrow, and Keep 30 days ago to the hour still holds', () => {
    expect(ids(sections([session('edge', 30), session('past', 31)]))).toEqual([[], ['past']]);
    expect(ids(sections([old], { kept: () => NOW - 30 * DAY }))).toEqual([[], []]);
    expect(ids(sections([old], { kept: () => NOW - 31 * DAY }))).toEqual([[], ['old']]);
  });
});

describe("Ready to finish's line", () => {
  const offered = [session('a', 40, [1])];
  it('says why it cannot answer: PR status off, a failed ask, or no answer yet; and nothing while it can, or while nothing links a PR', () => {
    expect(readyNote(offered, { prStatusOn: false, prStatus: { statuses: {}, problem: null } })).toBe("PR status is off in Settings, so which sessions' PRs are settled is not known.");
    expect(readyNote(offered, { prStatusOn: true, prStatus: { statuses: {}, problem: 'gh is missing' } })).toBe('GitHub could not be asked: gh is missing');
    expect(readyNote(offered, { prStatusOn: true, prStatus: { statuses: {}, problem: null } })).toBe('Asking GitHub…');
    expect(readyNote(offered, ready)).toBeNull();
    expect(readyNote([session('b', 40)], { ...ready, prStatusOn: false })).toBeNull();
  });
});
