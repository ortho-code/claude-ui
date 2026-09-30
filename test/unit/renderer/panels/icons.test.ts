import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ICON_NAMES, iconSvg, isIconName } from '../../../../src/renderer/panels/icons';

describe('the README', () => {
  it('names every icon a panel can pick, and no other, so the list cannot drift from the set', () => {
    const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8');
    const line = readme.split('\n').find((text) => text.startsWith('`icon` picks its icon by name:'));
    expect(line).toBeDefined();
    const named = [...line!.slice(line!.indexOf(':')).matchAll(/`([a-z]+)`/g)].map((match) => match[1]);
    expect([...named].sort()).toEqual([...ICON_NAMES].sort());
  });
});

describe('isIconName', () => {
  it.each(ICON_NAMES)('knows %s', (name) => expect(isIconName(name)).toBe(true));
  it.each(['rocket', '', 'Git', 'toString', 'constructor', 3, null])('refuses %j', (value) => expect(isIconName(value)).toBe(false));
});

describe('iconSvg', () => {
  it('draws on the 16-unit grid in currentColor, at the size asked', () => {
    const svg = iconSvg('git', 14);
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('width="14" height="14"');
    expect(svg).toContain('stroke="currentColor"');
  });

  it('keeps the rendered stroke at 1.3px whatever the size', () => {
    // 1.3px rendered at 14px is 1.49 viewBox units, the weight every 14px control icon in the app uses.
    expect(iconSvg('git', 14)).toContain('stroke-width="1.49"');
    expect(iconSvg('git', 16)).toContain('stroke-width="1.30"');
  });
});
