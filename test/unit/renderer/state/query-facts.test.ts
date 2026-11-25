import { describe, expect, it } from 'vitest';
import { store, type TabState } from '../../../../src/renderer/state/app';
import { queryFacts, queryFields, type QueryView } from '../../../../src/renderer/state/query-facts';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';
import { session, wasRunning } from '../fixtures';

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

  it('reads the worktree mark as the row shows it: a worktree it runs in, one it left, or a checkout it worked in', () => {
    const facts = queryFacts(view({}));
    expect(facts.worktree(session({ id: 'w' }))).toBe(false);
    expect(facts.worktree(session({ id: 'w', worktree: 'wt' }))).toBe(true);
    expect(facts.worktree(session({ id: 'w', leftWorktree: 'wt' }))).toBe(true);
    expect(facts.worktree(session({ id: 'w', checkouts: [{ root: '/repo/.claude/worktrees/wt', at: '2026-10-26T10:00:00.000Z', gone: false, own: false }] }))).toBe(true);
  });

  it('reads a session as gone when its folder is, as its dimmed row does', () => {
    const facts = queryFacts(view({}));
    expect(facts.gone(session({ id: 'g', cwd: '/gone', cwdExists: false }))).toBe(true);
    expect(facts.gone(session({ id: 'g' }))).toBe(false);
  });

  it('reads a note and a pin only on the session they belong to', () => {
    const facts = queryFacts(view({ notes: new Map([['a', 'waiting on kars']]), pinned: new Set(['a']) }));
    expect([facts.note(a), facts.note(b)]).toEqual(['waiting on kars', undefined]);
    expect([facts.pinned(a), facts.pinned(b)]).toEqual([true, false]);
  });

  it('says a session asks for you as its dot counts it: waiting and not read, or a reason its set-aside mark does not mute', () => {
    const c = session({ id: 'c' });
    const statuses = new Map([['a', 'waiting']]);
    const needsYou = new Map([['b', [wasRunning]], ['c', [wasRunning]]]);
    const setAside = new Map([['c', { due: null, at: 1 }]]);
    const facts = queryFacts(view({ statuses, needsYou, setAside }));
    expect([facts.asking(a), facts.asking(b), facts.asking(c)]).toEqual([true, true, false]);
    expect(queryFacts(view({ statuses, acked: new Set(['a']) })).asking(a)).toBe(false);
  });

  it('ranks a session by where what its dot shows stands in the strength order, the same as the sessions file', () => {
    const statuses = new Map([['a', 'waiting'], ['b', 'busy']]);
    const facts = queryFacts(view({ statuses }));
    expect(facts.rank(a)).toBeLessThan(facts.rank(b)!);
    expect(queryFacts(view({ statuses: new Map([['a', 'no-such-status']]) })).rank(a)).toBeNull();
  });

  it('names the project on show as current, or the one the asker shows', () => {
    expect(queryFacts(view({ activeProject: '/work/claude-ui' })).current).toBe('/work/claude-ui');
    expect(queryFacts(view({ activeProject: '/work/claude-ui' }), Date.now(), null).current).toBeNull();
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
