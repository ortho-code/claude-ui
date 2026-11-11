import { describe, it, expect } from 'vitest';
import type { NeedsYou } from '../../../../src/shared/types';
import { asksForYou, nudgeOf, rollUpWords, sessionPart, strongestNudge } from '../../../../src/renderer/status/rollup';
import { isNeeds, shownState } from '../../../../src/renderer/status/shown';
import { APP_ORDER, strengthOf, wasRunning } from '../fixtures';

describe('nudgeOf', () => {
  it('counts a live status, muted once read, and nothing for a session with none', () => {
    const table: [string | undefined, unread: string | null, read: string | null][] = [
      ['waiting', 'waiting', null],
      ['needs:pr.merged', 'needs:pr.merged', null],
      ['ready', 'ready', null],
      // Busy cannot be read (toggleAck), so the mark is never there to mute it.
      ['busy', 'busy', 'busy'],
      // Work still running is working, whatever the turn did: nothing to read, and no "finished" for a roll-up to carry.
      ['background', 'busy', 'busy'],
      ['closed', null, null],
      [undefined, null, null],
    ];
    for (const [status, unread, read] of table) {
      expect(nudgeOf(status, false), `${status} unread`).toBe(unread);
      expect(nudgeOf(status, true), `${status} read`).toBe(read);
    }
  });
});

describe('the default strength order', () => {
  // Today's rules before the order was yours, kept here as what the default must answer exactly (decided 2026-11-06), with a muted mark giving way to any status but closed (decided 2026-11-11).
  const dotBefore = (status: string | undefined, marked: boolean): string | undefined => (status === 'busy' || status === 'background' || status === 'waiting' ? status : marked ? 'needs' : status);
  const partBefore = (status: string | undefined, marked: boolean, muted: boolean, acked: boolean): string | null => {
    const shown = muted && status !== undefined && status !== 'closed' ? status : dotBefore(status, marked);
    const read = acked || (muted && shown === 'needs');
    if (shown === 'waiting' || shown === 'needs' || shown === 'ready') return read ? null : shown;
    return shown === 'busy' || shown === 'background' ? 'busy' : null;
  };
  const rollUpBefore = (parts: (string | null)[]): string | null => ['waiting', 'needs', 'ready', 'busy'].find((nudge) => parts.includes(nudge)) ?? null;
  const asBefore = (state: string | null | undefined): string | null | undefined => (isNeeds(state) ? 'needs' : state);

  const statuses = ['waiting', 'busy', 'background', 'ready', 'closed', undefined, 'compacting'];
  const reasonSets: NeedsYou[][] = [
    [],
    [wasRunning],
    [{ type: 'pr.merged', at: 3, pr: 'acme/app#1' }],
    [
      { type: 'pr.conflict', at: 2, pr: 'acme/app#1' },
      { type: 'app.reminder', at: 4 },
    ],
  ];
  const sessions = statuses.flatMap((status) => reasonSets.flatMap((reasons) => [false, true].flatMap((muted) => [false, true].map((acked) => ({ status, reasons, muted, acked })))));

  it("answers every session's dot as the rule before it did", () => {
    for (const { status, reasons } of sessions) expect(asBefore(shownState(status, reasons, APP_ORDER)), `${status} with ${reasons.length} reasons`).toBe(dotBefore(status, reasons.length > 0));
  });

  it('rolls every pair of sessions up as the rule before it did', () => {
    const parts = sessions.map(({ status, reasons, muted, acked }) => ({ now: sessionPart(status, reasons, muted, acked, APP_ORDER), before: partBefore(status, reasons.length > 0, muted, acked) }));
    for (const part of parts) expect(asBefore(part.now)).toBe(part.before);
    for (const a of parts) for (const b of parts) expect(asBefore(strongestNudge([a.now, b.now], APP_ORDER))).toBe(rollUpBefore([a.before, b.before]));
  });
});

describe('strongestNudge', () => {
  it('ranks waiting over needs over ready over busy', () => {
    expect(strongestNudge(['busy', 'ready', 'needs:pr.merged', 'waiting'], APP_ORDER)).toBe('waiting');
    expect(strongestNudge(['busy', 'ready', 'needs:pr.merged'], APP_ORDER)).toBe('needs:pr.merged');
    expect(strongestNudge(['busy', 'ready'], APP_ORDER)).toBe('ready');
    expect(strongestNudge([null], APP_ORDER)).toBeNull();
  });

  it('ranks the categories in the order, and what asks for you over what works whatever the order says of them', () => {
    expect(strongestNudge(['needs:pr.merged', 'needs:pr.conflict'], APP_ORDER)).toBe('needs:pr.conflict');
    expect(strongestNudge(['needs:pr.merged', 'needs:pr.conflict'], strengthOf(['waiting', 'finish-up', 'busy', 'background', 'needs-you', 'ready', 'closed']))).toBe('needs:pr.merged');
    expect(strongestNudge(['busy', 'needs:pr.merged'], strengthOf(['busy', 'waiting', 'background', 'needs-you', 'ready', 'closed']))).toBe('needs:pr.merged');
    expect(strongestNudge(['needs:pr.merged', 'ready'], strengthOf(['waiting', 'busy', 'background', 'ready', 'needs-you', 'closed']))).toBe('ready');
  });
});

describe('asksForYou', () => {
  it('is a turn that ended, waiting for you or finished, and nothing at work or with nothing to say', () => {
    expect(asksForYou('waiting')).toBe(true);
    expect(asksForYou('needs:app.reminder')).toBe(true);
    expect(asksForYou('ready')).toBe(true);
    expect(asksForYou('busy')).toBe(false);
    expect(asksForYou(null)).toBe(false);
  });
});

describe('rollUpWords', () => {
  it('names what asks for you, else what works, else nothing, outside the project on show or in what it rolls up', () => {
    expect(rollUpWords({ asking: 3, working: 2, badge: 'waiting' }, 'elsewhere')).toBe('3 sessions in other projects need you');
    expect(rollUpWords({ asking: 1, working: 0, badge: 'ready' }, 'here')).toBe('1 session needs you');
    expect(rollUpWords({ asking: 0, working: 2, badge: 'busy' }, 'elsewhere')).toBe('2 sessions in other projects are working');
    expect(rollUpWords({ asking: 0, working: 1, badge: 'busy' }, 'here')).toBe('1 session is working');
    expect(rollUpWords({ asking: 0, working: 0, badge: null }, 'here')).toBeNull();
  });
});

describe('sessionPart', () => {
  it('rolls a muted needs-you mark up as read, as its dot shows it, and claude working, asking or at its prompt over it as itself', () => {
    expect(sessionPart('ready', [wasRunning], false, false, APP_ORDER)).toBe('needs:app.was-running');
    expect(sessionPart('ready', [wasRunning], true, false, APP_ORDER)).toBe('ready');
    expect(sessionPart('ready', [wasRunning], true, true, APP_ORDER)).toBeNull();
    expect(sessionPart('closed', [wasRunning], true, false, APP_ORDER)).toBeNull();
    expect(sessionPart(undefined, [wasRunning], true, false, APP_ORDER)).toBeNull();
    expect(sessionPart('waiting', [wasRunning], true, false, APP_ORDER)).toBe('waiting');
    expect(sessionPart('busy', [wasRunning], true, false, APP_ORDER)).toBe('busy');
    expect(sessionPart('ready', [], false, false, APP_ORDER)).toBe('ready');
  });
});
