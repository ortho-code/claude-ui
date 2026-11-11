import { DEFAULT_STRENGTH, expandedStrength } from '../../shared/status/looks';
import { categoryOf, isPrReason, type NeedsYouRegistry } from '../../shared/status/needs-you';
import { mutedBySetAside } from '../../shared/status/session-marks';
import type { SetAside, NeedsYou, SessionGroup, SessionSummary } from '../../shared/types';
import { tabButton, type TabButton, type TabButtonTab } from '../rules/claude';
import { inView } from '../rules/session-filter';
import { projectsForSwitcher, type SwitcherModel } from '../rules/switcher';
import { displayName, entityKey, projectRootExists, sessionsByKey, unstartableReason } from '../rules/sessions';
import { sessionPart, type NudgeStatus } from '../status/rollup';
import { isNeeds, shownState, type Strength } from '../status/shown';
import { sameOrder, store, type TabState, type View } from './app';

/** What more than one surface reads out of the store: each takes the view it reads, so a repaint that calls one names those slices too. */

/** A project's name: the one you gave it, or its folder's. */
export const projName = (repoRoot: string, view: View<'projectNames'>): string => displayName(repoRoot, view.projectNames);

/**
 * Why a session cannot be opened, or null for one that can: finished, which is put away rather than resumed, as its row in the finished view does not open it either, or its folder gone (`unstartableReason`).
 * One rule for every ask that opens a session (`openSession`, `openTab`), and the session's siblings in its menu.
 */
export function unopenableReason(session: SessionSummary, view: View<'finished'> = store.get()): string | null {
  if (view.finished.has(entityKey(session))) return 'Finished: make it unfinished from the finished sessions to open it';
  return unstartableReason(session);
}

/** The groups belonging to one project, in registry order. */
export function projectGroups(repoRoot: string, { groupState }: View<'groupState'>): SessionGroup[] {
  return groupState.groups.filter((g) => g.repoRoot === repoRoot);
}

/** The name of the group a session is filed in; undefined when it is in none, in one the registry no longer has, or in one with no name. */
export function groupNameOf(session: SessionSummary, { groupState }: View<'groupState'>): string | undefined {
  return groupState.groups.find((g) => g.id === groupState.groupOf[entityKey(session)])?.name || undefined;
}

/** The tab a session is open in, if any. */
export function tabWith(sessionId: string, view: View<'tabs'> = store.get()): TabState | undefined {
  return view.tabs.find((t) => t.session.id === sessionId);
}

/** Whether a tab holds the session with its claude started and not yet gone: set once the start resolves, cleared when the window handles the exit. */
export function sessionRunning(sessionId: string, view: View<'tabs'> = store.get()): boolean {
  return (tabWith(sessionId, view)?.terminalId ?? null) !== null;
}

/** A tab as its button and its menu's leave items read it (`TabButtonTab`): its own flags, and whether a tab of its session is starting. */
export function leaveTab(tab: TabState, view: View<'tabs'> = store.get()): TabButtonTab {
  return { ...tab, sessionStarting: sessionStarting(entityKey(tab.session), view) };
}

/** Whether a tab of the session is starting, which leaves no claude yet to ask to leave for a finish (`finishSessions`). */
export function sessionStarting(key: string, view: View<'tabs'> = store.get()): boolean {
  return view.tabs.some((t) => entityKey(t.session) === key && t.starting);
}

/** A tab's button (`tabButton`), as the settings say (`Settings.leaveButton`), stop then close until they are read; null for none. */
export function tabButtonOf(tab: TabState, view: View<'settings' | 'tabs'> = store.get()): TabButton | null {
  return tabButton(leaveTab(tab, view), view.settings?.leaveButton.value ?? 'stop-close');
}

let ranking: { list: readonly string[]; registry: NeedsYouRegistry; strength: Strength } | null = null;

/**
 * The strength order in force (`Settings.strength`), as it ranks, over the needs-you categories as they stand: the default until the settings are read.
 * The same object for as long as the list and the needs-you registry are, through every read of the settings that leaves the list so, so a surface can tell a change of it by identity (`statusChanges`); a new registry with the same categories makes a new one, which only repaints more than it needs to.
 */
export function strengthNow(view: View<'settings' | 'needsYouTypes'>): Strength {
  const list = view.settings?.strength.value ?? DEFAULT_STRENGTH;
  if (ranking?.registry !== view.needsYouTypes || !sameOrder(ranking.list, list)) {
    const registry = view.needsYouTypes;
    ranking = { list, registry, strength: { order: expandedStrength(list, registry), categoryOf: (type) => categoryOf(registry, type) } };
  }
  return ranking.strength;
}

/**
 * What a session's own dot shows, wherever one stands for one session: what its tab says (`tabDot`), where it says anything, since the last report then describes a claude that has gone or is going; otherwise the first in the strength order of its status as its hooks last reported it and its needs-you reasons (`shownState`).
 * A roll-up reads the status and the reasons itself (`sessionNudge`).
 */
export function dotStatus(id: string, view: View<'statuses' | 'tabs' | 'needsYou' | 'settings' | 'needsYouTypes'>): string | undefined {
  const tab = tabWith(id, view);
  return (tab && tabDot(tab)) ?? shownState(view.statuses.get(id), view.needsYou.get(id) ?? [], strengthNow(view));
}

/**
 * What a tab says in its session's dot: `stopping` while its claude has been asked to leave and has not, however long that takes; otherwise nothing.
 * The ask can go unanswered, and only this says so, since the tab's button turns into a force after its first moment, until the force is pressed.
 */
export function tabDot(tab: TabState): 'stopping' | undefined {
  return tab.stopping && tab.terminalId !== null ? 'stopping' : undefined;
}

/** The tab on show, from the token the store keeps. */
export function tabOnShow(view: View<'tabs' | 'activeTab'>): TabState | null {
  return view.activeTab === null ? null : (view.tabs.find((t) => t.token === view.activeTab) ?? null);
}

/** The session behind an id, from its tab or the list; null for one the app no longer has. */
export function sessionById(id: string, view: View<'sessions' | 'tabs'> = store.get()): SessionSummary | null {
  return tabWith(id, view)?.session ?? view.sessions.find((s) => s.id === id) ?? null;
}

/**
 * The sessions the sidebar can show: every session on disk, plus the open tabs whose session has not written a transcript yet (so a fresh session appears in its project immediately).
 * A tab's id is the session's real id from the moment it is created, so this adds a row that the transcript later fills in — never a second row beside it.
 */
export function visibleSessions(view: View<'sessions' | 'tabs'>): SessionSummary[] {
  const tips = sessionsByKey(view.sessions);
  const knownIds = new Set(view.sessions.map((s) => s.id));
  const pending = view.tabs.filter((t) => !knownIds.has(t.session.id)).map((t) => t.session);
  return [...pending, ...tips.values()];
}

/** The switcher's project pool: every project's tips minus finished/pending-delete, independent of the search text and active project so you can always navigate to any project. */
export function switcherPool(view: View<'sessions' | 'tabs' | 'finished' | 'pendingDeletes'>): SessionSummary[] {
  return viewPool(visibleSessions(view), false, view);
}

/**
 * The projects whose sessions on disk are all finished, each with those sessions: such a project stays listed, empty and saying so, until its sessions are deleted.
 * One rule for the session list, the switcher and the fall back to All, so no surface lists a project another has dropped.
 */
export function finishedOnlyProjects(view: View<'sessions' | 'tabs' | 'finished' | 'pendingDeletes'>): Map<string, SessionSummary[]> {
  const all = visibleSessions(view);
  const shown = new Set(viewPool(all, false, view).map((s) => s.repoRoot));
  const kept = new Map<string, SessionSummary[]>();
  for (const session of viewPool(all, true, view)) {
    if (!shown.has(session.repoRoot)) kept.set(session.repoRoot, [...(kept.get(session.repoRoot) ?? []), session]);
  }
  return kept;
}

/** Every project the switcher lists: one with a session in view, or one whose sessions are all finished. */
export function listedProjects(view: View<'sessions' | 'tabs' | 'finished' | 'pendingDeletes'>): Set<string> {
  return new Set([...switcherPool(view).map((s) => s.repoRoot), ...finishedOnlyProjects(view).keys()]);
}

/**
 * Every project in the switcher's pool, counted and rolled up in the list's order, with those whose sessions are all finished counted at none, and all of them together: the one roll-up the switcher, the sidebar's rail icon and a panel's session dialog read.
 * Worked out for each reader rather than kept, since it costs well under a millisecond (0.07 ms at 382 sessions, measured).
 */
export function switcherModel(view: View<'sessions' | 'tabs' | 'finished' | 'pendingDeletes' | 'statuses' | 'acked' | 'needsYou' | 'setAside' | 'projectNames' | 'projectOrder' | 'settings' | 'needsYouTypes'>): SwitcherModel {
  return projectsForSwitcher(switcherPool(view), view.statuses, view.acked, view.needsYou, view.projectNames, view.projectOrder, finishedOnlyProjects(view), mutedNeedsYou(view), strengthNow(view));
}

/** The sessions a view holds before any filter, finished or not (see inView). */
export function viewPool(all: SessionSummary[], finishedView: boolean, view: View<'finished' | 'pendingDeletes'>): SessionSummary[] {
  return all.filter((s) => inView(entityKey(s), finishedView, view.finished, view.pendingDeletes));
}

/** The tabs actually on screen: a project view shows only its own. */
export function visibleTabs({ activeProject, tabs }: View<'activeProject' | 'tabs'>): readonly TabState[] {
  return activeProject ? tabs.filter((t) => t.session.repoRoot === activeProject) : tabs;
}

/**
 * Whether a project is dead, by the rule the session list and the switcher use, for the surfaces that hold only a repo root: the tab bar and the empty pane.
 * A root with no sessions to ask is not called dead.
 */
export function projectGone(repoRoot: string, view: View<'sessions' | 'tabs'>): boolean {
  const sessions = visibleSessions(view).filter((s) => s.repoRoot === repoRoot);
  return sessions.length > 0 && !projectRootExists(sessions);
}

/** What the search matches against: the box's contents, trimmed and in lower case; empty for no search. */
export function searchText({ filter }: View<'filter'>): string {
  return filter.search.trim().toLowerCase();
}

/** Whether any filter is on — the search, a pill, or a date window — which opens every fold and puts the filter's count and chips on screen. */
export function isFiltering(view: View<'filter'>): boolean {
  return searchText(view).length > 0 || Object.values(view.filter.filters).some(Boolean) || view.filter.datePreset !== 'any';
}

/** What a session's dot and its tooltip are painted from, and so what `statusChanges` compares. */
export type StatusView = View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'settings' | 'needsYouTypes' | 'prNames'>;

/** The slices of `StatusView`, for a watcher that follows the dots. */
export const STATUS_SLICES = ['statuses', 'backgroundTasks', 'acked', 'needsYou', 'setAside', 'settings', 'needsYouTypes', 'prNames'] as const;

/**
 * The sessions whose status, background work, read mark, needs-you mark or set-aside mark differs between two readings, or whose reasons name a PR while what the PRs are called changed: what a status change asks a surface to repaint, as a status event naming one session always has.
 * A change of the strength order (`strengthNow`) changes what any dot may show, so then every session with a status or a reason.
 */
export function statusChanges(before: StatusView, after: StatusView): Set<string> {
  if (strengthNow(before) !== strengthNow(after)) return new Set([...before.statuses.keys(), ...after.statuses.keys(), ...before.needsYou.keys(), ...after.needsYou.keys()]);
  const ids = new Set<string>();
  // A PR's title came or changed: the tooltip of every session whose reasons name a PR says it.
  if (before.prNames !== after.prNames) for (const [id, reasons] of after.needsYou) if (reasons.some(isPrReason)) ids.add(id);
  for (const id of new Set([...before.statuses.keys(), ...after.statuses.keys()])) if (before.statuses.get(id) !== after.statuses.get(id)) ids.add(id);
  for (const id of new Set([...before.backgroundTasks.keys(), ...after.backgroundTasks.keys()])) if (!sameOrder(before.backgroundTasks.get(id) ?? [], after.backgroundTasks.get(id) ?? [])) ids.add(id);
  for (const id of new Set([...before.acked, ...after.acked])) if (before.acked.has(id) !== after.acked.has(id)) ids.add(id);
  // Every reason and its time, since a reason added beside another, or a newer one lifting a set-aside mark's mute, changes the dot or its tooltip.
  for (const id of new Set([...before.needsYou.keys(), ...after.needsYou.keys()])) if (!sameReasons(before.needsYou.get(id) ?? [], after.needsYou.get(id) ?? [])) ids.add(id);
  for (const id of new Set([...before.setAside.keys(), ...after.setAside.keys()])) if (before.setAside.get(id) !== after.setAside.get(id)) ids.add(id);
  return ids;
}

/** Whether two lists of a session's reasons are the same reasons from the same times, in the same order. */
function sameReasons(a: readonly NeedsYou[], b: readonly NeedsYou[]): boolean {
  return a.length === b.length && a.every((reason, i) => reason.type === b[i]?.type && reason.at === b[i].at);
}

/** The sessions whose tab says something else in their dot between two readings of the tabs (`tabDot`), such as one whose claude was asked to leave: what a change of the tabs asks a session's dot to repaint (`dotStatus`). */
export function tabDotChanges(before: View<'tabs'>, after: View<'tabs'>): Set<string> {
  const dots = (view: View<'tabs'>): Map<string, string | undefined> => new Map(view.tabs.map((t) => [t.session.id, tabDot(t)]));
  const was = dots(before);
  const is = dots(after);
  return new Set([...was.keys(), ...is.keys()].filter((id) => was.get(id) !== is.get(id)));
}

/** A session's part in a roll-up (`sessionPart`), read out of the store: a needs-you mark its set-aside mark mutes rolls up as read. */
export function sessionNudge(id: string, view: View<'statuses' | 'acked' | 'needsYou' | 'setAside' | 'settings' | 'needsYouTypes'>): NudgeStatus {
  return sessionPart(view.statuses.get(id), view.needsYou.get(id) ?? [], mutedNeedsYou(view).has(id), view.acked.has(id), strengthNow(view));
}

/**
 * Whether a session's dot shows as read: marked read, or showing a needs-you mark its set-aside mark mutes, which looks read and stays so while the set-aside mark stands (decided 2026-10-29).
 * The dot still shows the mark, so its reason is there when you pick the session up again.
 */
export function shownRead(id: string, shown: string | undefined, view: View<'acked' | 'needsYou' | 'setAside'>): boolean {
  return view.acked.has(id) || (isNeeds(shown) && mutedNeedsYou(view).has(id));
}

let muted: { needsYou: ReadonlyMap<string, readonly NeedsYou[]>; setAside: ReadonlyMap<string, SetAside>; ids: ReadonlySet<string> } | null = null;

/**
 * The sessions whose needs-you mark their set-aside mark mutes (`mutedBySetAside`): what every dot and roll-up reads as read.
 * Kept for the two maps it was made from, since every roll-up of a repaint asks for it.
 */
export function mutedNeedsYou(view: View<'needsYou' | 'setAside'>): ReadonlySet<string> {
  if (muted?.needsYou !== view.needsYou || muted.setAside !== view.setAside) {
    const ids = new Set([...view.setAside.keys()].filter((id) => mutedBySetAside(view.needsYou.get(id), view.setAside.get(id))));
    muted = { needsYou: view.needsYou, setAside: view.setAside, ids };
  }
  return muted.ids;
}
