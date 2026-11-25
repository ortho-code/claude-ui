import { describe, expect, it } from 'vitest';
import { store, type TabState } from '../../../../src/renderer/state/app';
import { queryFacts, queryFields, type QueryView } from '../../../../src/renderer/state/query-facts';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';
import { session } from '../fixtures';

const a = session({ id: 'a', repoRoot: '/work/claude-ui' });
const b = session({ id: 'b', repoRoot: '/work/other' });
const tab = (s: typeof a, terminalId: string | null): TabState => ({ token: `t-${s.id}`, session: s, terminalId }) as TabState;
const view = (over: Partial<QueryView>): QueryView => ({ ...store.get(), ...over });

describe('queryFacts', () => {
  it('tells a session with a tab from one whose tab runs claude', () => {
    const facts = queryFacts(view({ tabs: [tab(a, 'term-1'), tab(b, null)] }));
    expect([facts.tabbed(a), facts.tabbed(b)]).toEqual([true, true]);
    expect([facts.running(a), facts.running(b)]).toEqual([true, false]);
  });

  it("names claude's ask by its type until the session is marked read", () => {
    const statuses = new Map([['a', 'waiting'], ['b', 'ready']]);
    expect([queryFacts(view({ statuses })).claudeAsks(a), queryFacts(view({ statuses })).claudeAsks(b)]).toEqual(['claude.asks', 'claude.ready']);
    expect(queryFacts(view({ statuses, acked: new Set(['a']) })).claudeAsks(a)).toBeNull();
    expect(queryFacts(view({ statuses: new Map([['a', 'busy']]) })).claudeAsks(a)).toBeNull();
  });

  it("names a session's group and its project as the list does", () => {
    const facts = queryFacts(view({ groupState: { groups: [{ id: 'g', name: 'Shelf', repoRoot: '/work/claude-ui' }], groupOf: { a: 'g' } }, projectNames: new Map([['/work/claude-ui', 'The app']]) }));
    expect([facts.groupName(a), facts.groupName(b)]).toEqual(['Shelf', undefined]);
    expect([facts.projectName(a), facts.projectName(b)]).toEqual(['The app', 'other']);
  });

  it("reads a PR's states, role and title from main's answer", () => {
    const pr = { repository: 'acme/app', number: 1, url: '' };
    const facts = queryFacts(view({ prStatus: { statuses: { 'acme/app#1': { state: 'merged', role: 'reviewing' } }, problem: null }, prNames: new Map([['acme/app#1', { title: 'Tick per host' }]]) }));
    expect([...facts.prStates(pr)]).toEqual(['merged']);
    expect(facts.prRole(pr)).toBe('reviewing');
    expect(facts.prTitle(pr)).toBe('Tick per host');
  });
});

describe('queryFields', () => {
  it('makes the fields again only when the needs-you categories and types change', () => {
    const registry = bundledNeedsYou();
    const first = queryFields({ needsYouTypes: registry });
    expect(queryFields({ needsYouTypes: registry })).toBe(first);
    expect(queryFields({ needsYouTypes: { ...registry } })).not.toBe(first);
    expect(first.fields.get('needs')?.values?.some((value) => value.value === 'finish-up')).toBe(true);
  });
});
