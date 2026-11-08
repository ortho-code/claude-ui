import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ICON_NAMES, isIconName } from '../../../src/shared/icons';

describe('the layout guide', () => {
  it('names every icon a panel can pick, and no other, so the list cannot drift from the set', () => {
    const guide = readFileSync(new URL('../../../docs/guide/layout.md', import.meta.url), 'utf8');
    const line = guide.split('\n').find((text) => text.startsWith('`icon` picks its icon by name:'));
    expect(line).toBeDefined();
    const named = [...line!.slice(line!.indexOf(':')).matchAll(/`([a-z]+)`/g)].map((match) => match[1]);
    expect([...named].sort()).toEqual([...ICON_NAMES].sort());
  });
});

describe('isIconName', () => {
  it.each(ICON_NAMES)('knows %s', (name) => expect(isIconName(name)).toBe(true));
  it.each(['rocket', '', 'Git', 'toString', 'constructor', 3, null])('refuses %j', (value) => expect(isIconName(value)).toBe(false));
});
