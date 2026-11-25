import { describe, expect, it } from 'vitest';
import type { ClaudeAsk, QueryFacts } from '../../../../src/shared/query/facts';
import { coreFields } from '../../../../src/shared/query/fields';
import type { NeedsYou, SessionSummary, SetAside } from '../../../../src/shared/types';
import { NOW } from '../../../../src/renderer/rules/now';
import { sectionsOf } from '../../../../src/renderer/rules/sectioned-view';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';
import { facts } from '../../shared/query/facts';
import { session as fixture } from '../fixtures';

// The cases of the needs-you panel type Now replaces, as far as they are which section a session is in and in what order; the lines under a row are its dot's (status-dot.test.ts), and the drawing the window's (test/renderer/panels/types/session-view).
const fields = coreFields(bundledNeedsYou());
const HERE = '/home/me/app';
const OTHER = '/home/me/other';
const HOUR = 3_600_000;
const T = new Date(2026, 10, 3, 12, 0).getTime();

/** A session and what the app holds of it, each field one fact answers. */
interface Given {
  id: string;
  project?: string;
  title?: string;
  asking?: boolean;
  running?: boolean;
  setAside?: SetAside;
  reasons?: NeedsYou[];
  ask?: ClaudeAsk;
  rank?: number | null;
}

function shown(given: Given[], current: string | null = HERE): Record<string, string[]> {
  const byId = new Map(given.map((each) => [each.id, each]));
  const of = (s: SessionSummary): Given => byId.get(s.id)!;
  const known: QueryFacts = facts({
    current,
    asking: (s) => of(s).asking === true,
    running: (s) => of(s).running === true,
    setAside: (s) => of(s).setAside,
    reasons: (s) => of(s).reasons ?? [],
    claudeAsks: (s) => of(s).ask ?? null,
    rank: (s) => (of(s).rank === undefined ? 1 : of(s).rank!),
    label: (s) => s.title,
  });
  const sessions = given.map((each) => fixture({ id: each.id, title: each.title ?? `Title ${each.id}`, repoRoot: each.project ?? HERE }));
  return Object.fromEntries(sectionsOf(NOW, sessions, fields, known).map((section) => [section.id, section.rows.map((row) => row.id)]));
}

const wasRunning = (at: number): NeedsYou => ({ type: 'app.was-running', at, how: 'quit' });
const reminder = (at: number): NeedsYou => ({ type: 'app.reminder', at });
const pr = (type: 'pr.merged' | 'pr.conflict', at: number): NeedsYou => ({ type, at, pr: 'o/r#1' });

describe('which section', () => {
  it('puts what asks for you under Needs you; else what runs under Running; else what is set aside or has reasons under Not now; nothing else at all', () => {
    const reason = [wasRunning(T)];
    expect(
      shown([
        { id: 'waiting', asking: true, running: true, ask: 'claude.asks' },
        { id: 'reason', asking: true, reasons: reason },
        { id: 'busy-with-reason', running: true, reasons: reason },
        { id: 'read-waiting', running: true },
        { id: 'read-reason', reasons: reason },
        { id: 'undated', setAside: { due: null, at: T } },
        { id: 'nothing' },
      ]),
    ).toEqual({ running: ['busy-with-reason', 'read-waiting'], 'needs-you': ['waiting', 'reason'], elsewhere: [], 'not-now': ['undated', 'read-reason'] });
  });

  it('keeps a running session that is set aside under Running, and one that asks under Needs you', () => {
    expect(shown([{ id: 'aside', running: true, setAside: { due: null, at: T } }, { id: 'asks', running: true, asking: true }])).toMatchObject({ running: ['aside'], 'needs-you': ['asks'] });
  });

  it('shows only the project on show in This project, and every project in All', () => {
    const given = [
      { id: 'here', asking: true },
      { id: 'there', asking: true, project: OTHER },
    ];
    expect(shown(given)['needs-you']).toEqual(['here']);
    expect(shown(given, null)['needs-you']).toEqual(['here', 'there']);
  });

  it("holds under Elsewhere, in This project, other projects' sessions that ask for you and then those running, never their set-aside or read ones", () => {
    const given: Given[] = [
      { id: 'here', asking: true },
      { id: 'there-busy', project: OTHER, running: true },
      { id: 'there-conflict', project: OTHER, asking: true, reasons: [pr('pr.conflict', T)], rank: 2 },
      { id: 'there-waiting', project: OTHER, asking: true, running: true, ask: 'claude.asks', rank: 0 },
      { id: 'there-read', project: OTHER, reasons: [wasRunning(T)] },
      { id: 'there-aside', project: OTHER, setAside: { due: null, at: T } },
    ];
    expect(shown(given)).toEqual({ running: [], 'needs-you': ['here'], elsewhere: ['there-waiting', 'there-conflict', 'there-busy'], 'not-now': [] });
    expect(shown(given, null).elsewhere).toEqual([]);
  });
});

describe('the order', () => {
  it('runs Running by project folder, then title, then id', () => {
    const order = shown(
      [
        { id: 'b', running: true, title: 'Same' },
        { id: 'a', running: true, title: 'Same' },
        { id: 'first', running: true, title: 'Zeta', project: '/home/me/aaa' },
        { id: 'c', running: true, title: 'Alpha' },
      ],
      null,
    ).running;
    expect(order).toEqual(['first', 'c', 'a', 'b']);
  });

  it('puts a set-aside session with news under Needs you after every one not set aside, whatever its rank', () => {
    const later = { due: T + HOUR, at: T - HOUR };
    const order = shown([
      { id: 'aside-conflict', asking: true, rank: 4, setAside: later, reasons: [pr('pr.conflict', T)] },
      { id: 'aside-waiting', asking: true, rank: 0, setAside: later, ask: 'claude.asks' },
      { id: 'plain-reason', asking: true, rank: 7, reasons: [wasRunning(T - 2 * HOUR)] },
      { id: 'ready', asking: true, rank: 3, ask: 'claude.ready' },
    ])['needs-you'];
    expect(order).toEqual(['ready', 'plain-reason', 'aside-waiting', 'aside-conflict']);
  });

  it("runs Needs you by rank; within one, claude's asks by their newest reason, asks alone after those with one, then reasons only by their oldest, then the id", () => {
    const order = shown([
      { id: 'reminders-new', asking: true, rank: 7, reasons: [wasRunning(T - HOUR)] },
      { id: 'reminders-old', asking: true, rank: 7, reasons: [wasRunning(T - 2 * HOUR)] },
      { id: 'reminders-mixed', asking: true, rank: 7, reasons: [reminder(T - 3 * HOUR), wasRunning(T)] },
      { id: 'ready-b', asking: true, rank: 3, ask: 'claude.ready' },
      { id: 'ready-a', asking: true, rank: 3, ask: 'claude.ready' },
      { id: 'ready-merged', asking: true, rank: 3, ask: 'claude.ready', reasons: [pr('pr.merged', T - 9 * HOUR)] },
      { id: 'merged', asking: true, rank: 8, reasons: [pr('pr.merged', T - 9 * HOUR)] },
      { id: 'waiting', asking: true, rank: 0, ask: 'claude.asks' },
      { id: 'checks-failed', asking: true, rank: 4, reasons: [pr('pr.conflict', T - 10 * HOUR)] },
    ])['needs-you'];
    expect(order).toEqual(['waiting', 'ready-merged', 'ready-a', 'ready-b', 'checks-failed', 'reminders-mixed', 'reminders-old', 'reminders-new', 'merged']);
  });

  it("puts, within one rank, a row claude asks of before a row of reasons only, whatever their reasons' times", () => {
    const order = shown([
      { id: 'reasons-only', asking: true, rank: 7, reasons: [reminder(T - 5 * HOUR), wasRunning(T)] },
      { id: 'ready-reminder', asking: true, rank: 7, ask: 'claude.ready', reasons: [reminder(T - 2 * HOUR)] },
    ])['needs-you'];
    expect(order).toEqual(['ready-reminder', 'reasons-only']);
  });

  it('puts a row without a rank after every ranked one', () => {
    expect(shown([{ id: 'unranked', asking: true, rank: null, reasons: [pr('pr.conflict', T)] }, { id: 'reminder', asking: true, rank: 7, reasons: [reminder(T - 3 * HOUR)] }])['needs-you']).toEqual(['reminder', 'unranked']);
  });

  it('runs Not now with the set-aside first, soonest due first and undated last, then reasons only, newest first', () => {
    const order = shown([
      { id: 'whenever', setAside: { due: null, at: T } },
      { id: 'far', setAside: { due: new Date(2026, 10, 10, 9, 0).getTime(), at: T } },
      { id: 'near', setAside: { due: new Date(2026, 10, 4, 9, 30).getTime(), at: T } },
      { id: 'old-read', reasons: [pr('pr.merged', T - 2 * HOUR)] },
      { id: 'new-read', reasons: [pr('pr.merged', T - HOUR)] },
    ])['not-now'];
    expect(order).toEqual(['near', 'far', 'whenever', 'new-read', 'old-read']);
  });
});
