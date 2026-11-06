import { describe, it, expect } from 'vitest';
import { needsYouRegistry } from '../../../src/shared/needsyou';

const category = (id: string, order: number, more: object = {}) => ({ name: `${id}.jsonc`, json: { kind: 'category', id, label: id, order, ...more } });
const type = (id: string, cat: string, more: object = {}) => ({ name: `${id}.jsonc`, json: { kind: 'type', id, label: id, category: cat, ...more } });

describe('the needs-you categories and types, checked', () => {
  it('reads categories in their order and types by id, each on unless it says otherwise', () => {
    const { registry, problems } = needsYouRegistry([type('b.two', 'late'), category('late', 20), type('a.one', 'early', { enabled: false }), category('early', 10)]);
    expect(problems).toEqual([]);
    expect(registry.categories).toEqual([
      { id: 'early', label: 'early', order: 10, enabled: true },
      { id: 'late', label: 'late', order: 20, enabled: true },
    ]);
    expect(registry.types).toEqual([
      { id: 'a.one', label: 'a.one', category: 'early', enabled: false },
      { id: 'b.two', label: 'b.two', category: 'late', enabled: true },
    ]);
  });

  it('orders two categories at the same place by id', () => {
    expect(needsYouRegistry([category('b', 10), category('a', 10)]).registry.categories.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('leaves out a file with a mistake, whole, and names it', () => {
    const cases: [unknown, string][] = [
      [[], 'holds no object'],
      [{ kind: 'view', id: 'x', label: 'x' }, '"kind" is "view", not "category" or "type"'],
      [{ kind: 'type', id: 'x', label: 'x', category: 'c', icon: 'eye' }, 'a type has no "icon"'],
      [{ kind: 'category', id: 'x', label: 'x', order: 1, category: 'c' }, 'a category has no "category"'],
      [{ kind: 'type', id: ' ', label: 'x', category: 'c' }, '"id" is missing or empty'],
      [{ kind: 'type', id: 'x', category: 'c' }, '"label" is missing or empty'],
      [{ kind: 'type', id: 'x', label: 'x', category: 'c', enabled: 'no' }, '"enabled" is not true or false'],
      [{ kind: 'category', id: 'x', label: 'x', order: '1' }, '"order" is not a number'],
      [{ kind: 'type', id: 'x', label: 'x' }, '"category" is missing or empty'],
    ];
    for (const [json, problem] of cases) {
      const { registry, problems } = needsYouRegistry([category('c', 1), { name: 'bad.jsonc', json }]);
      expect(problems).toEqual([`bad.jsonc: ${problem}`]);
      expect(registry.types).toEqual([]);
      expect(registry.categories.map((c) => c.id)).toEqual(['c']);
    }
  });

  it('uses neither of two files with one id, and names both', () => {
    const { registry, problems } = needsYouRegistry([category('c', 1), type('x', 'c'), { name: 'other.jsonc', json: { kind: 'category', id: 'x', label: 'X', order: 2 } }]);
    expect(problems).toEqual(['x.jsonc, other.jsonc: all have the id "x", so none is used']);
    expect(registry).toEqual({ categories: [{ id: 'c', label: 'c', order: 1, enabled: true }], types: [] });
  });

  it('leaves out a type whose category no file holds', () => {
    const { registry, problems } = needsYouRegistry([type('x', 'nowhere')]);
    expect(problems).toEqual(['x.jsonc: no category has the id "nowhere"']);
    expect(registry.types).toEqual([]);
  });
});
