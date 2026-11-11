import { describe, it, expect } from 'vitest';
import type { NeedsYou, PrNeedsYouType } from '../../../../src/shared/types';
import { needsYouLines, setAsideLabel, setAsideUntil, stateLines, statusLabel, type DotStates } from '../../../../src/renderer/status/state-lines';
import { momentLabel } from '../../../../src/renderer/ui/time-words';
import { APP_ORDER, strengthOf, wasRunning } from '../fixtures';

describe('statusLabel', () => {
  it('names each status as a state', () => {
    expect(statusLabel('busy')).toBe('Busy');
    expect(statusLabel('ready')).toBe('Ready');
    expect(statusLabel('waiting')).toBe('Waiting for you');
    // Not "Stopped": the status arrives from SessionEnd, which fires whether the session was stopped, finished on its own, or had its tab closed — so naming the event would be wrong twice over.
    expect(statusLabel('closed')).toBe('Not running');
  });

  it('names a session on its way to a stop', () => {
    expect(statusLabel('stopping')).toBe('Stopping — waiting for claude to leave');
  });

  it('falls back to the raw value for a status it has never heard of', () => {
    // A new hook state should read oddly, not crash — but it SHOULD read oddly, which is the signal to name it here.
    expect(statusLabel('compacting')).toBe('compacting');
  });

  // Counted per type, each type in the order claude listed it first.
  it('names the work still running after the turn ended, counted by type', () => {
    expect(statusLabel('background', ['shell'])).toBe('Working in the background: 1 shell');
    expect(statusLabel('background', ['shell', 'subagent', 'shell'])).toBe('Working in the background: 2 shells, 1 subagent');
    expect(statusLabel('background', ['MCP task', 'MCP task'])).toBe('Working in the background: 2 MCP tasks');
  });

  // A status read back at launch, or work of a type the script could not read, says only what is known.
  it('says no more than that for background work it was told nothing about', () => {
    expect(statusLabel('background')).toBe('Working in the background');
    expect(statusLabel('background', [])).toBe('Working in the background');
  });

  it('names the work only for background', () => {
    expect(statusLabel('busy', ['shell'])).toBe('Busy');
  });
});

describe('needsYouLines', () => {
  const texts = (reasons: NeedsYou[], strength = APP_ORDER): string[] => needsYouLines(reasons, strength).map((line) => line.text);

  it('says why a session needs you, by how the app closed while it ran', () => {
    expect(texts([wasRunning])).toEqual(['Needs you — was running when the app quit']);
    expect(texts([{ type: 'app.was-running', at: 1, how: 'ended' }])).toEqual(['Needs you — was running when the app ended without quitting']);
    expect(texts([{ type: 'app.was-running', at: 1, how: 'unknown' }])).toEqual(['Needs you — was running when the app last closed']);
  });

  it('says which day a reminder was for, from when it was marked', () => {
    expect(texts([{ type: 'app.reminder', at: new Date(2026, 10, 2, 9).getTime() }])).toEqual(['Needs you — reminder for Mon 2 Nov, 09:00']);
  });

  it("says which PR changed and into what, by its category's place in the order, newest first within one", () => {
    const pr = (number: number, at: number, ...types: PrNeedsYouType[]): NeedsYou[] => types.map((type) => ({ type, at, pr: `acme/app#${number}` }));
    // One answer's changes are a reason each at one moment, named together in the same order whatever order they are kept in.
    const reasons = [wasRunning, ...pr(1, 8, 'pr.approved'), ...pr(2, 1, 'pr.merged'), ...pr(3, 2, 'pr.reopened'), ...pr(4, 3, 'pr.changes-requested'), ...pr(5, 4, 'pr.conflict'), ...pr(6, 0, 'pr.approved', 'pr.checks-failed')];
    expect(texts(reasons)).toEqual([
      'Needs you — PR #5 merge conflict',
      'Needs you — PR #4 changes requested',
      'Needs you — PR #6 checks failed, approved',
      'Needs you — PR #1 approved',
      'Needs you — PR #3 reopened',
      'Needs you — was running when the app quit',
      'Needs you — PR #2 merged',
    ]);
  });

  it("names one answer's changes in the order's order too", () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.reopened', at: 1, pr: 'acme/app#7' },
      { type: 'pr.approved', at: 1, pr: 'acme/app#7' },
    ];
    expect(texts(reasons)).toEqual(['Needs you — PR #7 approved, reopened']);
    expect(needsYouLines(reasons, APP_ORDER)[0]?.state).toBe('needs:pr.approved');
  });

  it('follows an order of your own', () => {
    const reasons: NeedsYou[] = [wasRunning, { type: 'pr.merged', at: 0, pr: 'acme/app#2' }];
    expect(texts(reasons, strengthOf(['waiting', 'finish-up', 'busy', 'background', 'needs-you', 'ready', 'closed']))).toEqual(['Needs you — PR #2 merged', 'Needs you — was running when the app quit']);
  });

  it("names one answer's changes of a PR spelt with other capitals on one line, and no repository for it", () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.reopened', at: 1, pr: 'acme/app#7' },
      { type: 'pr.approved', at: 1, pr: 'Acme/App#7' },
    ];
    expect(texts(reasons)).toEqual(['Needs you — PR #7 approved, reopened']);
  });

  it('names the repository only where the reasons name PRs in more than one', () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.merged', at: 2, pr: 'acme/app#1' },
      { type: 'pr.merged', at: 1, pr: 'acme/site#2' },
    ];
    expect(texts(reasons)).toEqual(['Needs you — PR acme/app#1 merged', 'Needs you — PR acme/site#2 merged']);
  });

  it("names a PR's changes from different answers on lines of their own", () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.checks-failed', at: 1, pr: 'acme/app#1' },
      { type: 'pr.approved', at: 2, pr: 'acme/app#1' },
    ];
    expect(texts(reasons)).toEqual(['Needs you — PR #1 checks failed', 'Needs you — PR #1 approved']);
  });

  it('lists reasons of one category newest first', () => {
    const reminder: NeedsYou = { type: 'app.reminder', at: new Date(2026, 10, 2, 9).getTime() };
    expect(texts([reminder, { ...wasRunning, at: reminder.at + 1 }])).toEqual(['Needs you — was running when the app quit', 'Needs you — reminder for Mon 2 Nov, 09:00']);
    expect(texts([reminder, { ...wasRunning, at: reminder.at - 1 }])).toEqual(['Needs you — reminder for Mon 2 Nov, 09:00', 'Needs you — was running when the app quit']);
  });
});

describe('stateLines', () => {
  const states = (over: Partial<DotStates>): DotStates => ({ tab: undefined, status: undefined, background: [], reasons: [], acked: false, muted: false, ...over });
  const texts = (over: Partial<DotStates>, strength = APP_ORDER): string[] => stateLines(states(over), strength).map((line) => line.text);

  it('lists every state, the one the dot shows first', () => {
    expect(texts({ status: 'busy', reasons: [wasRunning] })).toEqual(['Busy', 'Needs you — was running when the app quit']);
    expect(texts({ status: 'ready', reasons: [wasRunning] })).toEqual(['Needs you — was running when the app quit', 'Ready']);
    expect(texts({ status: 'ready', reasons: [wasRunning] }, strengthOf(['waiting', 'busy', 'background', 'ready', 'needs-you', 'closed']))).toEqual(['Ready', 'Needs you — was running when the app quit']);
  });

  it("leads with what the tab says, and leaves a status nobody named last, as itself", () => {
    expect(texts({ tab: 'stopping', status: 'busy', reasons: [wasRunning] })).toEqual(['Stopping — waiting for claude to leave', 'Busy', 'Needs you — was running when the app quit']);
    expect(texts({ status: 'compacting', reasons: [wasRunning] })).toEqual(['Needs you — was running when the app quit', 'compacting']);
  });

  it('marks read what the dot shows, every reason where it shows one, and a muted reason wherever it is', () => {
    expect(texts({ status: 'waiting', acked: true })).toEqual(['Waiting for you (read)']);
    expect(texts({ status: 'ready', reasons: [wasRunning, { type: 'app.reminder', at: 0 }], acked: true })).toEqual([
      'Needs you — was running when the app quit (read)',
      `Needs you — reminder for ${momentLabel(0)} (read)`,
      'Ready',
    ]);
    expect(texts({ status: 'busy', reasons: [wasRunning], muted: true })).toEqual(['Busy', 'Needs you — was running when the app quit (read)']);
  });

  it('never marks a stop on its way read, since its claude is leaving', () => {
    expect(texts({ tab: 'stopping', acked: true })).toEqual(['Stopping — waiting for claude to leave']);
  });

  it('says nothing at all for a session with nothing to report', () => {
    // The hollow dot: no tooltip rather than an empty one, so closest() falls through to whatever it sits in.
    expect(texts({})).toEqual([]);
  });
});

describe('the words of a set-aside mark', () => {
  // Local times, as the dialog makes them: Thursday 29 October 2026, mid-afternoon.
  const thursday = new Date(2026, 9, 29, 15, 30).getTime();

  it('names a mark by its moment or as whenever', () => {
    expect(setAsideLabel({ due: new Date(2026, 10, 5, 9).getTime(), at: thursday })).toBe('Set aside until Thu 5 Nov, 09:00');
    expect(setAsideLabel({ due: null, at: thursday })).toBe('Set aside, whenever');
    expect(setAsideUntil(null)).toBe(', whenever');
  });
});
