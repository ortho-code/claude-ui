import { describe, expect, it } from 'vitest';
import { headingTick, tickedOnShow, tickedRun } from '../../../src/renderer/ticks';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('the run a Shift+press ticks', () => {
  it('goes from the row last pressed to the one pressed, both included, down or up', () => {
    expect(tickedRun(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(tickedRun(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(tickedRun(order, 'c', 'c')).toEqual(['c']);
  });

  it('is only the row pressed without a row pressed before, or when that row is no longer drawn', () => {
    expect(tickedRun(order, null, 'c')).toEqual(['c']);
    expect(tickedRun(order, 'gone', 'c')).toEqual(['c']);
  });
});

describe("a heading's box", () => {
  it('shows all, some or none of the rows under it ticked, and none for a heading with no rows', () => {
    expect(headingTick(['a', 'b'], new Set(['a', 'b', 'x']))).toBe('all');
    expect(headingTick(['a', 'b'], new Set(['b']))).toBe('some');
    expect(headingTick(['a', 'b'], new Set(['x']))).toBe('none');
    expect(headingTick([], new Set(['a']))).toBe('none');
  });
});

describe('what the bar acts on', () => {
  it('is the ticked rows on show, in the order drawn, never one out of sight', () => {
    expect(tickedOnShow(order, new Set(['e', 'gone', 'b']))).toEqual(['b', 'e']);
  });
});
