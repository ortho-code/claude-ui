import { describe, it, expect } from 'vitest';
import { firesFor, needsYouRegistry, typeIsOn, withOverrides } from '../../../src/shared/needsyou';

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
      { id: 'a.one', label: 'a.one', category: 'early', enabled: false, roles: null },
      { id: 'b.two', label: 'b.two', category: 'late', enabled: true, roles: null },
    ]);
  });

  it('reads the roles a PR’s type fires for, and none for a type that lists none', () => {
    const { registry, problems } = needsYouRegistry([category('c', 1), type('pr.conflict', 'c', { roles: ['own', 'reviewing'] }), type('pr.merged', 'c')]);
    expect(problems).toEqual([]);
    expect(registry.types.map(({ id, roles }) => [id, roles])).toEqual([
      ['pr.conflict', ['own', 'reviewing']],
      ['pr.merged', null],
    ]);
  });

  it('leaves out a type with roles that are not a PR’s type’s, or not a list of known roles each once, and names it', () => {
    const cases: [object, string][] = [
      [{ kind: 'type', id: 'app.reminder', label: 'x', category: 'c', roles: ['own'] }, '"roles" belongs only to a PR’s type'],
      [{ kind: 'type', id: 'pr.conflict', label: 'x', category: 'c', roles: [] }, '"roles" is not a list of one or more of "own", "reviewing", "other"'],
      [{ kind: 'type', id: 'pr.conflict', label: 'x', category: 'c', roles: 'own' }, '"roles" is not a list of one or more of "own", "reviewing", "other"'],
      [{ kind: 'type', id: 'pr.conflict', label: 'x', category: 'c', roles: ['own', 'author'] }, '"roles" names "author", which is not one of "own", "reviewing", "other"'],
      [{ kind: 'type', id: 'pr.conflict', label: 'x', category: 'c', roles: ['own', 'own'] }, '"roles" names a role more than once'],
    ];
    for (const [json, problem] of cases) {
      const { registry, problems } = needsYouRegistry([category('c', 1), { name: 'bad.jsonc', json }]);
      expect(problems).toEqual([`bad.jsonc: ${problem}`]);
      expect(registry.types).toEqual([]);
    }
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

describe('the needs-you categories and types with your files applied', () => {
  const registry = needsYouRegistry([category('early', 10), category('late', 20), type('t.one', 'early'), type('t.two', 'late')]).registry;

  it('switches a type or a category off, changes a label, moves a type, and reorders the categories', () => {
    const { registry: read, problems } = withOverrides(registry, [
      { name: 'one.json', json: { id: 't.one', enabled: false, label: 'One' } },
      { name: 'two.json', json: { id: 't.two', category: 'early' } },
      { name: 'late.json', json: { id: 'late', order: 5 } },
    ]);
    expect(problems).toEqual([]);
    expect(read.categories.map((c) => c.id)).toEqual(['late', 'early']);
    expect(read.types).toEqual([
      { id: 't.one', label: 'One', category: 'early', enabled: false, roles: null },
      { id: 't.two', label: 't.two', category: 'early', enabled: true, roles: null },
    ]);
  });

  it('changes the roles a PR’s type fires for, and names a file giving roles to a type that is no PR’s', () => {
    const prs = needsYouRegistry([category('early', 10), type('pr.conflict', 'early', { roles: ['own'] }), type('t.one', 'early')]).registry;
    const { registry: read, problems } = withOverrides(prs, [
      { name: 'conflict.json', json: { id: 'pr.conflict', roles: ['own', 'reviewing'] } },
      { name: 'one.json', json: { id: 't.one', roles: ['own'] } },
    ]);
    expect(problems).toEqual(['one.json: "roles" belongs only to a PR’s type']);
    expect(read.types.map(({ id, roles }) => [id, roles])).toEqual([
      ['pr.conflict', ['own', 'reviewing']],
      ['t.one', null],
    ]);
  });

  it('names a file that moves a type to no category, or changes what a kind does not have, and leaves it unused', () => {
    const { registry: read, problems } = withOverrides(registry, [
      { name: 'nowhere.json', json: { id: 't.one', category: 'nowhere' } },
      { name: 'order.json', json: { id: 't.two', order: 1 } },
      { name: 'empty.json', json: { id: 'early', label: '' } },
    ]);
    expect(problems).toEqual(['nowhere.json: "category" is "nowhere", which no category has as its id', 'order.json: a type has no "order" to change', 'empty.json: "label" is not text']);
    expect(read).toEqual(registry);
  });

  it('says a type marks while it and its category are on, and a type it does not have marks', () => {
    expect(typeIsOn(registry, 't.one')).toBe(true);
    expect(typeIsOn(withOverrides(registry, [{ name: 'x.json', json: { id: 't.one', enabled: false } }]).registry, 't.one')).toBe(false);
    expect(typeIsOn(withOverrides(registry, [{ name: 'x.json', json: { id: 'early', enabled: false } }]).registry, 't.one')).toBe(false);
    expect(typeIsOn(registry, 'unknown')).toBe(true);
  });

  it('says a PR’s type fires for the roles it lists, for every role where it lists none, and for no role not known where it lists some', () => {
    const prs = needsYouRegistry([category('early', 10), type('pr.conflict', 'early', { roles: ['own'] }), type('pr.merged', 'early')]).registry;
    expect(firesFor(prs, 'pr.conflict', 'own')).toBe(true);
    expect(firesFor(prs, 'pr.conflict', 'reviewing')).toBe(false);
    expect(firesFor(prs, 'pr.conflict', null)).toBe(false);
    expect(firesFor(prs, 'pr.merged', 'other')).toBe(true);
    expect(firesFor(prs, 'pr.merged', null)).toBe(true);
    expect(firesFor(prs, 'pr.unknown', 'other')).toBe(true);
  });
});
