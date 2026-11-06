import { describe, it, expect } from 'vitest';
import { roleOf } from '../../../src/shared/prs';

describe('roleOf', () => {
  it('is own for a PR you wrote, whatever else holds', () => {
    expect(roleOf(true, false, false)).toBe('own');
    expect(roleOf(true, true, true)).toBe('own');
  });

  it('is reviewing for someone else’s PR you reviewed or are asked to review', () => {
    expect(roleOf(false, true, false)).toBe('reviewing');
    expect(roleOf(false, false, true)).toBe('reviewing');
  });

  it('is other for someone else’s PR with neither', () => {
    expect(roleOf(false, false, false)).toBe('other');
  });
});
