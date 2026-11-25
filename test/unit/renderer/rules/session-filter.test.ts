import { describe, it, expect } from 'vitest';
import { inView } from '../../../../src/renderer/rules/session-filter';

describe('inView', () => {
  const finished = new Set(['old']);
  const pendingDeletes = new Set(['going']);

  it('holds the sessions that are not finished in the normal view, and only the finished ones in the finished view', () => {
    expect(inView('live', false, finished, pendingDeletes)).toBe(true);
    expect(inView('old', false, finished, pendingDeletes)).toBe(false);
    expect(inView('old', true, finished, pendingDeletes)).toBe(true);
    expect(inView('live', true, finished, pendingDeletes)).toBe(false);
  });

  it('holds a session on its way to the trash in neither view, finished or not', () => {
    expect(inView('going', false, finished, pendingDeletes)).toBe(false);
    expect(inView('going', true, new Set(['going']), pendingDeletes)).toBe(false);
  });
});
