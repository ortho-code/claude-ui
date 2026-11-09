import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../../../../src/shared/types';
import { recentOrder } from '../../../../src/renderer/rules/recent';

const at = (id: string, lastActivity: string): SessionSummary => ({ id, lastActivity }) as SessionSummary;

describe('recentOrder', () => {
  it('puts the last worked on first', () => {
    const order = recentOrder([at('old', '2026-09-01T08:00:00.000Z'), at('new', '2026-09-30T08:00:00.000Z'), at('mid', '2026-09-15T08:00:00.000Z')]);
    expect(order.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('compares times rather than text, so an offset sorts by the moment it names', () => {
    // 09:30 at +02:00 is 07:30 UTC, before 08:00 UTC, though its text sorts after it.
    const order = recentOrder([at('offset', '2026-09-30T09:30:00.000+02:00'), at('utc', '2026-09-30T08:00:00.000Z')]);
    expect(order.map((s) => s.id)).toEqual(['utc', 'offset']);
  });

  it('sorts a time it cannot read last, and leaves what it was given as it was', () => {
    const given = [at('unreadable', 'not a time'), at('read', '2026-09-30T08:00:00.000Z')];
    expect(recentOrder(given).map((s) => s.id)).toEqual(['read', 'unreadable']);
    expect(given.map((s) => s.id)).toEqual(['unreadable', 'read']);
  });
});
