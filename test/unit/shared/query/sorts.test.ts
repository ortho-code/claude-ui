import { describe, expect, it } from 'vitest';
import { SORTS } from '../../../../src/shared/query/sorts';
import { session } from '../../renderer/fixtures';

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
