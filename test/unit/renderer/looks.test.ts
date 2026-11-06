import { describe, it, expect } from 'vitest';
import { DEFAULT_LOOKS, PALETTE } from '../../../src/shared/looks';
import { lookClass, lookOf, lookRules } from '../../../src/renderer/looks';

describe('lookOf', () => {
  it.each([
    ['needs:pr.merged', 'pr.merged'],
    ['needs', 'needs-you'],
    ['busy', 'busy'],
    ['compacting', 'compacting'],
    ['stopping', null],
    ['failed', null],
  ])('draws %s in the look of %s', (state, look) => expect(lookOf(state)).toBe(look));
});

describe('lookClass', () => {
  it('keeps an id to what a class name holds', () => {
    expect(lookClass('pr.merged')).toBe('look-pr.merged');
    expect(lookClass('my type')).toBe('look-my_type');
  });
});

describe('lookRules', () => {
  it('escapes the dot in an id, so the rule reaches the class rather than a second one', () => {
    expect(lookRules('pr.merged', DEFAULT_LOOKS['needs-you'])).toContain('.nudge.look-pr\\.merged {');
  });

  it("gives its colour as --look to anything carrying the class, for a toast's edge", () => {
    expect(lookRules('idle', DEFAULT_LOOKS.idle)).toContain(`.look-idle { --look: ${PALETTE.green}; }`);
  });

  it('spins a spinner whatever its pulse says, and draws a core only where it has one', () => {
    const busy = lookRules('busy', { ...DEFAULT_LOOKS.busy, pulse: true })
      .split('\n')
      .find((rule) => rule.startsWith('.nudge.look-busy {'));
    expect(busy).toContain('animation: spin 1.5s linear infinite');
    expect(busy).not.toContain('animation: pulse');
    expect(busy).not.toContain('background-clip');
    expect(lookRules('background', DEFAULT_LOOKS.background)).toContain(`background: ${PALETTE.green}; background-clip: content-box`);
  });

  it("draws an icon in the dot's place, over its box rather than in it, and as a plain dot on a rail icon's corner", () => {
    const rules = lookRules('pr.merged', { ...DEFAULT_LOOKS['needs-you'], mark: 'check' });
    expect(rules).toContain('.nudge.look-pr\\.merged::before { content: \'\'; position: absolute; inset: -2px;');
    expect(rules).toContain('mask: url("data:image/svg+xml,');
    expect(rules).toContain('.dotted-icon > .nudge.look-pr\\.merged::before { content: none; }');
    expect(rules).toContain(`.dotted-icon > .nudge.look-pr\\.merged { padding: 0; border-width: 1px; border-color: ${PALETTE.mauve}; background: ${PALETTE.mauve}; animation: pulse 1.2s ease-in-out infinite; }`);
  });
});
