import { describe, expect, it } from 'vitest';
import type { QueryFacts } from '../../../../src/shared/query/facts';
import { SORTS } from '../../../../src/shared/query/sorts';
import type { NeedsYou, SessionSummary } from '../../../../src/shared/types';
import { session } from '../../renderer/fixtures';
import { facts } from './facts';

const at = (id: string, lastActivity: string) => session({ id, lastActivity });

describe('SORTS', () => {
  const given = [at('mid', '2026-09-15T08:00:00.000Z'), at('new', '2026-09-30T08:00:00.000Z'), at('old', '2026-09-01T08:00:00.000Z')];

  it('activity puts the last worked on first', () => {
    expect([...given].sort(SORTS.activity).map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('activity-oldest puts the longest untouched first', () => {
    expect([...given].sort(SORTS['activity-oldest']).map((s) => s.id)).toEqual(['old', 'mid', 'new']);
  });

  it('activity compares moments, not text, so an offset reads as the time it is', () => {
    expect([at('offset', '2026-09-30T09:30:00.000+02:00'), at('utc', '2026-09-30T08:00:00.000Z')].sort(SORTS.activity).map((s) => s.id)).toEqual(['utc', 'offset']);
  });
});

const reason = (at: number): NeedsYou => ({ type: 'app.reminder', at });
const byId = <T>(table: Record<string, T>) => (s: SessionSummary): T | undefined => table[s.id];
const sorted = (name: keyof typeof SORTS, ids: string[], known: Partial<QueryFacts>): string[] => {
  const given = facts(known);
  return ids.map((id) => session({ id, title: id })).sort((a, b) => SORTS[name](a, b, given)).map((s) => s.id);
};

describe('strength', () => {
  it('puts what is not set aside first, then the stronger dot, then the id', () => {
    const order = sorted('strength', ['z-aside', 'y-weak', 'x-strong', 'w-strong'], { setAside: (s) => (s.id === 'z-aside' ? { due: null, at: 0 } : undefined), rank: (s) => (s.id.endsWith('strong') ? 1 : s.id === 'y-weak' ? 2 : 0) });
    expect(order).toEqual(['w-strong', 'x-strong', 'y-weak', 'z-aside']);
  });

  it("within a rank, puts claude's asks first, newest reason first, then reasons only, longest waiting first", () => {
    const reasons = byId({ 'ask-old': [reason(1)], 'ask-new': [reason(5)], 'wait-new': [reason(9)], 'wait-old': [reason(2), reason(8)] });
    const order = sorted('strength', ['wait-new', 'ask-old', 'wait-old', 'ask-new'], { rank: () => 1, claudeAsks: (s) => (s.id.startsWith('ask') ? 'claude.asks' : null), reasons: (s) => reasons(s) ?? [] });
    expect(order).toEqual(['ask-new', 'ask-old', 'wait-old', 'wait-new']);
  });
});

describe('project', () => {
  it('orders by project folder, then what the row is called, then the id', () => {
    const given = facts({ label: (s) => (s.id === 'b' ? 'zz' : 'aa') });
    const sessions = [session({ id: 'a', repoRoot: '/work/b' }), session({ id: 'b', repoRoot: '/work/a' }), session({ id: 'c', repoRoot: '/work/a' }), session({ id: 'd', repoRoot: '/work/a' })];
    const order = sessions.sort((x, y) => SORTS.project(x, y, given)).map((s) => s.id);
    expect(order).toEqual(['c', 'd', 'b', 'a']);
  });
});

describe('due', () => {
  it('puts the set-aside first, soonest due first and undated last, then the newest reason first', () => {
    const aside = byId({ later: { due: 20, at: 0 }, soon: { due: 10, at: 0 }, whenever: { due: null, at: 0 } });
    const reasons = byId({ 'news-old': [reason(1)], 'news-new': [reason(9)] });
    const order = sorted('due', ['news-old', 'whenever', 'news-new', 'later', 'soon'], { setAside: aside, reasons: (s) => reasons(s) ?? [] });
    expect(order).toEqual(['soon', 'later', 'whenever', 'news-new', 'news-old']);
  });
});

describe('asking-then-project', () => {
  it('puts what asks for you first by strength, then the rest by project', () => {
    const order = sorted('asking-then-project', ['run-b', 'ask-weak', 'run-a', 'ask-strong'], { asking: (s) => s.id.startsWith('ask'), rank: (s) => (s.id === 'ask-strong' ? 1 : 2), label: (s) => s.title });
    expect(order).toEqual(['ask-strong', 'ask-weak', 'run-a', 'run-b']);
  });
});
