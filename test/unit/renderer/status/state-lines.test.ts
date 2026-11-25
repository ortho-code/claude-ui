import { beforeAll, describe, it, expect } from 'vitest';
import type { NeedsYou, PrNeedsYouType } from '../../../../src/shared/types';
import { settingsView } from '../../../../src/shared/config/settings';
import { store } from '../../../../src/renderer/state/app';
import { needsYouLines, setAsideLabel, setAsideUntil, stateLines, statusLabel, type DotStates } from '../../../../src/renderer/status/state-lines';
import { momentInLanguage } from '../../../../src/renderer/ui/locale';
import { APP_ORDER, strengthOf, wasRunning } from '../fixtures';

// The moments these lines name are written in the language of the settings, so one is set rather than the machine's being taken: Dutch, whose day and month names differ from the app's own English words.
beforeAll(() => store.set({ settings: settingsView({ name: 'settings.json', status: 'read', error: null, json: { locale: 'nl-NL' } }) }));

describe('statusLabel', () => {
  it('names each status as a state', () => {
    expect(statusLabel('busy')).toBe('Working');
    expect(statusLabel('ready')).toBe('At its prompt');
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
    expect(statusLabel('busy', ['shell'])).toBe('Working');
  });
});

describe('needsYouLines', () => {
  const untitled = (): undefined => undefined;
  const texts = (reasons: NeedsYou[], strength = APP_ORDER, titles: (reference: string) => string | undefined = untitled): string[] => needsYouLines(reasons, strength, titles).map((line) => line.text);

  it('says why a session needs you, by how the app closed while it ran', () => {
    expect(texts([wasRunning])).toEqual(['Was running when the app quit']);
    expect(texts([{ type: 'app.was-running', at: 1, how: 'ended' }])).toEqual(['Was running when the app ended without quitting']);
    expect(texts([{ type: 'app.was-running', at: 1, how: 'unknown' }])).toEqual(['Was running when the app last closed']);
  });

  it('says which day a reminder was for, from when it was marked', () => {
    expect(texts([{ type: 'app.reminder', at: new Date(2026, 10, 2, 9).getTime() }])).toEqual(['Reminder for ma 2 nov, 09:00']);
  });

  it("says which PR changed and into what, by its category's place in the order, newest first within one", () => {
    const pr = (number: number, at: number, ...types: PrNeedsYouType[]): NeedsYou[] => types.map((type) => ({ type, at, pr: `acme/app#${number}` }));
    // One answer's changes are a reason each at one moment, named together in the same order whatever order they are kept in.
    const reasons = [wasRunning, ...pr(1, 8, 'pr.approved'), ...pr(2, 1, 'pr.merged'), ...pr(3, 2, 'pr.reopened'), ...pr(4, 3, 'pr.changes-requested'), ...pr(5, 4, 'pr.conflict'), ...pr(6, 0, 'pr.approved', 'pr.checks-failed')];
    expect(texts(reasons)).toEqual([
      'PR #5 merge conflict',
      'PR #4 changes requested',
      'PR #6 checks failed, approved',
      'PR #1 approved',
      'PR #3 reopened',
      'Was running when the app quit',
      'PR #2 merged',
    ]);
  });

  it("names one answer's changes in the order's order too", () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.reopened', at: 1, pr: 'acme/app#7' },
      { type: 'pr.approved', at: 1, pr: 'acme/app#7' },
    ];
    expect(texts(reasons)).toEqual(['PR #7 approved, reopened']);
    expect(needsYouLines(reasons, APP_ORDER, untitled)[0]?.state).toBe('needs:pr.approved');
  });

  it('follows an order of your own', () => {
    const reasons: NeedsYou[] = [wasRunning, { type: 'pr.merged', at: 0, pr: 'acme/app#2' }];
    expect(texts(reasons, strengthOf(['waiting', 'finish-up', 'busy', 'background', 'needs-you', 'ready', 'closed']))).toEqual(['PR #2 merged', 'Was running when the app quit']);
  });

  it("names one answer's changes of a PR spelt with other capitals on one line, and no repository for it", () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.reopened', at: 1, pr: 'acme/app#7' },
      { type: 'pr.approved', at: 1, pr: 'Acme/App#7' },
    ];
    expect(texts(reasons)).toEqual(['PR #7 approved, reopened']);
  });

  it('names the repository only where the reasons name PRs in more than one', () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.merged', at: 2, pr: 'acme/app#1' },
      { type: 'pr.merged', at: 1, pr: 'acme/site#2' },
    ];
    expect(texts(reasons)).toEqual(['PR acme/app#1 merged', 'PR acme/site#2 merged']);
  });

  it("names a PR's changes from different answers on lines of their own", () => {
    const reasons: NeedsYou[] = [
      { type: 'pr.checks-failed', at: 1, pr: 'acme/app#1' },
      { type: 'pr.approved', at: 2, pr: 'acme/app#1' },
    ];
    expect(texts(reasons)).toEqual(['PR #1 checks failed', 'PR #1 approved']);
  });

  it("names a PR by its title where it is known, cut on a long one, set apart from what changed", () => {
    const titles = (reference: string): string | undefined => ({ 'acme/app#1': 'Scheduler tick per host', 'acme/app#2': 'A'.repeat(80) })[reference];
    const reasons: NeedsYou[] = [
      { type: 'pr.merged', at: 3, pr: 'acme/app#1' },
      { type: 'pr.merged', at: 2, pr: 'acme/app#2' },
      { type: 'pr.merged', at: 1, pr: 'acme/app#3' },
    ];
    expect(texts(reasons, APP_ORDER, titles)).toEqual([`PR #1 · Scheduler tick per host — merged`, `PR #2 · ${'A'.repeat(59)}… — merged`, 'PR #3 merged']);
  });

  it('lists reasons of one category newest first', () => {
    const reminder: NeedsYou = { type: 'app.reminder', at: new Date(2026, 10, 2, 9).getTime() };
    expect(texts([reminder, { ...wasRunning, at: reminder.at + 1 }])).toEqual(['Was running when the app quit', 'Reminder for ma 2 nov, 09:00']);
    expect(texts([reminder, { ...wasRunning, at: reminder.at - 1 }])).toEqual(['Reminder for ma 2 nov, 09:00', 'Was running when the app quit']);
  });
});

describe('stateLines', () => {
  const states = (over: Partial<DotStates>): DotStates => ({ tab: undefined, status: undefined, background: [], reasons: [], acked: false, muted: false, ...over });
  const texts = (over: Partial<DotStates>, strength = APP_ORDER): string[] => stateLines(states(over), strength, () => undefined).map((line) => line.text);

  it('lists every state, the one the dot shows first', () => {
    expect(texts({ status: 'busy', reasons: [wasRunning] })).toEqual(['Working', 'Needs you — was running when the app quit']);
    expect(texts({ status: 'ready', reasons: [wasRunning] })).toEqual(['Needs you — was running when the app quit', 'At its prompt']);
    expect(texts({ status: 'ready', reasons: [wasRunning] }, strengthOf(['waiting', 'busy', 'background', 'ready', 'needs-you', 'closed']))).toEqual(['At its prompt', 'Needs you — was running when the app quit']);
  });

  it("leads each reason with Needs you, keeping a PR's capitals", () => {
    expect(texts({ reasons: [{ type: 'pr.merged', at: 0, pr: 'acme/app#2' }] })).toEqual(['Needs you — PR #2 merged']);
  });

  it('leaves a reason bare for a surface whose heading says it, the status and the read mark as ever', () => {
    const bare = stateLines(states({ status: 'ready', reasons: [wasRunning], acked: true }), APP_ORDER, () => undefined, false).map((line) => line.text);
    expect(bare).toEqual(['Was running when the app quit (read)', 'At its prompt']);
  });

  it("leads with what the tab says, and leaves a status nobody named last, as itself", () => {
    expect(texts({ tab: 'stopping', status: 'busy', reasons: [wasRunning] })).toEqual(['Stopping — waiting for claude to leave', 'Working', 'Needs you — was running when the app quit']);
    expect(texts({ status: 'compacting', reasons: [wasRunning] })).toEqual(['Needs you — was running when the app quit', 'compacting']);
  });

  it('marks read what the dot shows, every reason where it shows one, and a muted reason wherever it is', () => {
    expect(texts({ status: 'waiting', acked: true })).toEqual(['Waiting for you (read)']);
    expect(texts({ status: 'ready', reasons: [wasRunning, { type: 'app.reminder', at: 0 }], acked: true })).toEqual([
      'Needs you — was running when the app quit (read)',
      `Needs you — reminder for ${momentInLanguage(0)} (read)`,
      'At its prompt',
    ]);
    expect(texts({ status: 'busy', reasons: [wasRunning], muted: true })).toEqual(['Working','Needs you — was running when the app quit (read)']);
  });

  it('leads with the status a muted reason gives way to, unread', () => {
    expect(texts({ status: 'ready', reasons: [wasRunning], muted: true })).toEqual(['At its prompt', 'Needs you — was running when the app quit (read)']);
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
    expect(setAsideLabel({ due: new Date(2026, 10, 5, 9).getTime(), at: thursday })).toBe('Set aside until do 5 nov, 09:00');
    expect(setAsideLabel({ due: null, at: thursday })).toBe('Set aside, whenever');
    expect(setAsideUntil(null)).toBe(', whenever');
  });
});
