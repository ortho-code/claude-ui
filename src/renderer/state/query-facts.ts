import type { ClaudeAsk, PrState, QueryFacts } from '../../shared/query/facts';
import type { FieldRegistry } from '../../shared/query/field';
import { coreFields } from '../../shared/query/fields';
import { prKey } from '../../shared/sessions/prs';
import type { NeedsYouRegistry } from '../../shared/status/needs-you';
import type { SessionPr } from '../../shared/types';
import { entityKey, unstartableReason, worktreeMarkState } from '../rules/sessions';
import { approvalsIn, prRoleOf, prStatesOf } from '../status/pr-status';
import type { View } from './app';
import { projName } from './views';

/** What a query's facts read of the store. */
export type QueryView = View<'tabs' | 'pinned' | 'finished' | 'pendingDeletes' | 'statuses' | 'acked' | 'setAside' | 'kept' | 'notes' | 'groupState' | 'projectNames' | 'needsYou' | 'prStatus' | 'prNames' | 'settings'>;

/** Session key -> its group's name. */
function groupNameByKey({ groupState }: View<'groupState'>): Map<string, string> {
  const byId = new Map(groupState.groups.map((g) => [g.id, g.name]));
  const out = new Map<string, string>();
  for (const [key, id] of Object.entries(groupState.groupOf)) {
    const name = byId.get(id);
    if (name) out.set(key, name);
  }
  return out;
}

/** Claude's ask as its type: waiting, or ready, until the session is marked read. */
function claudeAskOf(status: string | undefined, read: boolean): ClaudeAsk | null {
  if (read) return null;
  if (status === 'waiting') return 'claude.asks';
  return status === 'ready' ? 'claude.ready' : null;
}

/**
 * The store's answers to a query's questions, as of `now`.
 * Built once per evaluation over every session, so the sets every session asks about are made once here rather than per session.
 */
export function queryFacts(view: QueryView, now = Date.now()): QueryFacts {
  const tabbed = new Set(view.tabs.map((t) => entityKey(t.session)));
  const running = new Set(view.tabs.filter((t) => t.terminalId !== null).map((t) => entityKey(t.session)));
  const groups = groupNameByKey(view);
  const approvals = approvalsIn(view.settings);
  const states = new Map<string, Set<PrState>>();
  const statesOf = (pr: SessionPr): Set<PrState> => {
    const key = prKey(pr);
    const known = states.get(key) ?? prStatesOf(pr, view.prStatus, approvals);
    states.set(key, known);
    return known;
  };
  return {
    now,
    pinned: (s) => view.pinned.has(entityKey(s)),
    tabbed: (s) => tabbed.has(entityKey(s)),
    running: (s) => running.has(entityKey(s)),
    finished: (s) => view.finished.has(entityKey(s)),
    deleting: (s) => view.pendingDeletes.has(entityKey(s)),
    status: (s) => view.statuses.get(entityKey(s)),
    setAside: (s) => view.setAside.get(entityKey(s)),
    kept: (s) => view.kept.get(entityKey(s)),
    note: (s) => view.notes.get(entityKey(s)),
    groupName: (s) => groups.get(entityKey(s)),
    projectName: (s) => projName(s.repoRoot, view),
    reasons: (s) => view.needsYou.get(entityKey(s)) ?? [],
    claudeAsks: (s) => claudeAskOf(view.statuses.get(entityKey(s)), view.acked.has(entityKey(s))),
    worktree: (s) => worktreeMarkState(s) !== null,
    gone: (s) => unstartableReason(s) !== null,
    prRole: (pr) => prRoleOf(pr, view.prStatus),
    prStates: statesOf,
    prTitle: (pr) => view.prNames.get(prKey(pr))?.title,
  };
}

let fields: { needsYou: NeedsYouRegistry; registry: FieldRegistry } | null = null;

/** Every field a query can name, made again only when the needs-you categories and types change. */
export function queryFields(view: View<'needsYouTypes'>): FieldRegistry {
  if (fields?.needsYou !== view.needsYouTypes) fields = { needsYou: view.needsYouTypes, registry: coreFields(view.needsYouTypes) };
  return fields.registry;
}
