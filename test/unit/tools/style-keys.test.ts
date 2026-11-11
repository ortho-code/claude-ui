import { describe, expect, it } from 'vitest';
import { renamed } from '../../renderer/styles/keys.ts';

const none = new Map<string, string[]>();

describe('a style capture key', () => {
  it('keeps a class with a dot in its name whole, as the capture escapes it', () => {
    const line = String.raw`#list > span.look-pr\.changes-requested.needs.nudge | color: red`;
    expect(renamed(line, none)).toBe(line);
  });

  it('sorts classes by their names, as the capture does in the page, not by how they are escaped', () => {
    // Unescaped, `a.b` sorts before `aZ` ('.' is below 'Z'); escaped, the backslash sorts after it.
    expect(renamed(String.raw`span.aZ.a\.b`, none)).toBe(String.raw`span.a\.b.aZ`);
  });

  it('renames a class beside one with a dot in its name, and leaves the value alone', () => {
    const renames = new Map([['nudge', ['dot']]]);
    expect(renamed(String.raw`#list > span.look-pr\.closed.nudge | content: ".nudge"`, renames)).toBe(String.raw`#list > span.dot.look-pr\.closed | content: ".nudge"`);
  });

  it('renames a class with a dot in its name by that name', () => {
    const renames = new Map([['look-pr.closed', ['look-pr.shut']]]);
    expect(renamed(String.raw`span.look-pr\.closed.nudge`, renames)).toBe(String.raw`span.look-pr\.shut.nudge`);
  });
});
