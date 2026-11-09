import { describe, it, expect } from 'vitest';
import { overriddenById } from '../../../../src/shared/config/overrides';

const shipped = [
  { id: 'a', kind: 'type', label: 'A', enabled: true },
  { id: 'b', kind: 'view', label: 'B', enabled: true },
];
const text = (value: unknown): string | null => (typeof value === 'string' ? null : 'is not text');
const fields = { type: { label: text, enabled: (value: unknown) => (typeof value === 'boolean' ? null : 'is not true or false') }, view: { label: text } };

describe('override by id', () => {
  it('changes only the fields a file names, and leaves every other field and item as shipped', () => {
    expect(overriddenById(shipped, [{ name: 'a.json', json: { id: 'a', enabled: false } }], fields)).toEqual({
      items: [{ id: 'a', kind: 'type', label: 'A', enabled: false }, shipped[1]],
      problems: [],
    });
  });

  it('takes a kind that says what the item is', () => {
    expect(overriddenById(shipped, [{ name: 'b.json', json: { id: 'b', kind: 'view', label: 'Bee' } }], fields).items[1]).toEqual({ id: 'b', kind: 'view', label: 'Bee', enabled: true });
  });

  it('leaves out a file with a mistake, whole, and names it', () => {
    const cases: [unknown, string][] = [
      [[], 'holds no object'],
      [{ label: 'x' }, '"id" is missing or empty'],
      [{ id: 'nope' }, 'nothing the app ships has the id "nope"'],
      [{ id: 'a', kind: 'view' }, '"a" is a type, so "kind" cannot be "view"'],
      [{ id: 'b', enabled: false }, 'a view has no "enabled" to change'],
      [{ id: 'a', label: 'fine', enabled: 'no' }, '"enabled" is not true or false'],
    ];
    for (const [json, problem] of cases) expect(overriddenById(shipped, [{ name: 'x.json', json }], fields)).toEqual({ items: shipped, problems: [`x.json: ${problem}`] });
  });

  it('uses neither of two files changing one id, and names both', () => {
    const files = [
      { name: 'one.json', json: { id: 'a', label: 'One' } },
      { name: 'two.json', json: { id: 'a', enabled: false } },
      { name: 'b.json', json: { id: 'b', label: 'Bee' } },
    ];
    expect(overriddenById(shipped, files, fields)).toEqual({ items: [shipped[0], { ...shipped[1], label: 'Bee' }], problems: ['one.json, two.json: all change "a", so none is used'] });
  });
});
