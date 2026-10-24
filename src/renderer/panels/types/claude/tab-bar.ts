import type Sortable from 'sortablejs';
import { element, fromMarkup } from '../../../dom';
import { drawFoldChevron, foldChevron, offerRowFold } from '../../../fold-chevron';
import { Keyed, placeChildren } from '../../../keyed';
import { asksForYou, clockOf, orderAsTabs, reorderWithinGroup, sessionLabel, statusLabel, strongestNudge, tabButtonState, unstartableReason, worktreeMarkState } from '../../../logic';
import { markProjectGone } from '../../../projectgone';
import { store, type TabState, type View } from '../../../state/app';
import { showInStrip } from '../../../state/strip';
import { projName, projectGone, projectGroups, sessionNudge, statusChanges, visibleTabs } from '../../../state/views';
import { scheduledMark, showScheduled } from '../../../scheduledmark';
import { ackOnClick, applyStatus, badgeClass } from '../../../statusdot';
import { layersIcon, SIBLING_ICON, WORKTREE_ICON } from '../../../svg';
import { buildTab, drawTab, dropSortable, sortableTabs, type TabEls } from '../../../tab';
import { setTooltip } from '../../../tooltip';
import { hostOf } from '../builtin';
import { activateTab, closeOrStop, persistOpenTabs, tabOf } from './terminals';
import './tab-bar.css';

/**
 * The terminal area's tab bar: a tab per open session, clustered by project and group in the order the sidebar uses, each with its status dot, its marks and its two-step close, and reordered by dragging within its cluster.
 * It folds to the row of the tab on show, to give the terminal the room, from the fold chevron on the line under it.
 * It draws from the store (`renderTabBar`, a watcher the terminal area registers, watch.ts), and asks the sidebar to show where a tab's session, project or group lives.
 */

/** The tab bar, built here and placed by the terminal area (index.ts). */
export const tabbar = fromMarkup(`<div id="tabbar"></div>`);

/**
 * The line under the bar, which the tabs sit on, and its fold: the fold chevron a panel group folds from on its divider (fold-chevron.ts), centred on the line and pointing the way the bar's edge moves.
 * A tab it hides that asks for you turns it into that tab's status dot (`drawFold`).
 * Folded is kept for the next launch (`tabBarExpanded`, claude/stored-view.ts).
 * Placed under the bar by the terminal area (index.ts).
 */
export const tabbarEdge = fromMarkup(`<div id="tabbar-edge" hidden></div>`);
const fold = foldChevron('horizontal');
fold.id = 'tabbar-fold';
const foldDot = element('span', 'nudge');
foldDot.hidden = true;
fold.append(foldDot);
tabbarEdge.append(fold);
fold.addEventListener('click', () => store.set({ tabBarExpanded: !store.get().tabBarExpanded }));

// The key a tab is grouped and dragged within: its project, plus its group when it has one.
// A drag stays inside its own cluster because each cluster is its own Sortable container.
function tabClusterKey(tab: TabState, groupOf: Record<string, string> = store.get().groupState.groupOf): string {
  return `${tab.session.repoRoot}\0${groupOf[tab.session.id] ?? ''}`;
}

// One row per cluster: a project's ungrouped tabs share the project's own row, and each of its groups gets an indented row beneath it behind the same rail the sidebar uses.
// A project view drops the project label (everything shown belongs to it) but keeps the group rows.
/** What the tab bar draws from the store. */
type TabBarView = View<'sessions' | 'statuses' | 'backgroundTasks' | 'scheduledTasks' | 'acked' | 'archived' | 'groupState' | 'projectNames' | 'projectOrder' | 'activeProject' | 'tabs' | 'activeTab' | 'tabBarExpanded'>;

export function renderTabBar(view: TabBarView): void {
  // The library owns the bar's tabs while one is dragged — it moves them, and puts its copy of the dragged one in its row — so a redraw then would undo the drag under the pointer; the drop draws what was held (`sortableFor`).
  if (tabDragActive) {
    drawHeld = true;
    return;
  }
  const { activeProject, tabBarExpanded } = view;
  const shown = visibleTabs(view);
  const { groupOf } = view.groupState;
  // Your project order, the same one the sidebar and the strip use — so all three agree about where a project sits.
  // The bar used to order projects by whichever it met first, which nobody chose and which moved on its own: closing a project's last tab and opening another sent that project to the end.
  const clustered = orderAsTabs(
    shown.map((tab) => ({ repoRoot: tab.session.repoRoot, groupId: groupOf[tab.session.id] ?? '', item: tab })),
    (root) => projectGroups(root, view).map((g) => g.id),
    view.projectOrder,
  );
  const byCluster = new Map(clustered.map((c) => [`${c.repoRoot}\0${c.groupId}`, c.items]));
  const roots = [...new Set(clustered.map((c) => c.repoRoot))];
  // Folded, the bar keeps one row: the one holding the tab on show, or with none on show the first that holds a tab, so the pane's "Pick a tab above" always has one above it.
  // A cluster rather than the tab's own group, since a tab filed in another project's group sits in its project's own row (`orderAsTabs`).
  const kept = tabBarExpanded ? null : (clustered.find((c) => c.items.some((tab) => tab.token === view.activeTab)) ?? clustered[0]);
  const keptKey = kept ? `${kept.repoRoot}\0${kept.groupId}` : null;
  const drawn = (key: string): boolean => tabBarExpanded || key === keptKey;

  const children: HTMLElement[] = [];
  /** How many rows the bar has unfolded: a project's own row where it has loose tabs, or in All its name, and a row per group with tabs. */
  let openRows = 0;
  for (const root of roots) {
    // The project's own row: its label (in All) and every tab of its that is in no group.
    const loose = byCluster.get(`${root}\0`) ?? [];
    if (!activeProject || loose.length > 0) openRows += 1;
    if ((!activeProject || loose.length > 0) && drawn(`${root}\0`)) {
      const projectRow = projectRows.draw(`${root}\0`, buildProjectRow);
      if (!activeProject) drawProjectLabel(projectRow, root, view);
      placeChildren(projectRow.row, [...(activeProject ? [] : [projectRow.label]), ...loose.map((tab) => drawSessionTab(tab, view))]);
      children.push(projectRow.row);
    }
    // Then one row per group that has tabs open, in registry order — the sidebar's order.
    for (const group of projectGroups(root, view)) {
      const groupTabs = byCluster.get(`${root}\0${group.id}`) ?? [];
      if (groupTabs.length > 0) openRows += 1;
      if (groupTabs.length === 0 || !drawn(`${root}\0${group.id}`)) continue;
      const { row, rail, label, name, project } = groupRows.draw(`${root}\0${group.id}`, buildGroupRow);
      name.data = group.name;
      // Folded in All, the row is the bar's only one, and nothing else on it says which project it is: its project's name goes in front, as the project's own row has it.
      const named = !activeProject && !tabBarExpanded;
      if (named) drawProjectLabel(project, root, view);
      placeChildren(row, [...(named ? [project.label] : []), rail, label, ...groupTabs.map((tab) => drawSessionTab(tab, view))]);
      children.push(row);
    }
  }
  placeChildren(tabbar, children);
  // The line goes with the last tab, as the live strip goes when it has nothing: an empty bar has nothing to sit on a line.
  tabbarEdge.hidden = shown.length === 0;
  offerRowFold(fold, openRows);
  if (shown.length > 0) drawFold(tabBarExpanded, kept ? shown.filter((tab) => !kept.items.includes(tab)) : [], view);
  // What this draw did not draw is gone: a tab closed or out of the project on show, or a row with no tab left in it, whose Sortable goes with it.
  projectRows.sweep();
  groupRows.sweep();
  tabEls.sweep();
}

/**
 * The fold as the bar now is: which way it points (up while the bar is open, the way its edge moves as it folds), what it says, and whether it is the dot of a tab it hides (`hidden`) that asks for you, the strongest of them, which the stylesheet puts in the arrow's place.
 * Only what asks for you (`asksForYou`): a tab at work asks nothing, and with a few at work out of sight, a chevron that turned for them would hardly ever be a chevron.
 * It always folds the bar to one row, whatever is on show, so that is what it says.
 */
function drawFold(expanded: boolean, hidden: readonly TabState[], view: View<'statuses' | 'acked'>): void {
  const asking = strongestNudge(hidden.map((tab) => sessionNudge(tab.session.id, view)).filter(asksForYou));
  const label = expanded ? 'Fold the tab bar to one row' : asking ? `Unfold the tab bar: a tab out of sight is ${statusLabel(asking)?.toLowerCase()}` : 'Unfold the tab bar';
  drawFoldChevron(fold, expanded ? 'up' : 'down', label);
  fold.setAttribute('aria-expanded', String(expanded));
  fold.classList.toggle('asking', asking !== null);
  foldDot.className = badgeClass(asking);
  foldDot.hidden = asking === null;
}

/**
 * A status or a mark read changed: the bar draws again when one of its tabs' dots is among those that changed since it last followed them (`before`).
 * A watcher the terminal area registers (watch.ts).
 */
export function tabBarFollowsStatuses(view: TabBarView, before: View<'statuses' | 'backgroundTasks' | 'acked'>): void {
  const ids = statusChanges(before, view);
  if (view.tabs.some((t) => ids.has(t.session.id))) renderTabBar(view);
}

/** A row of the bar and its Sortable, which lives as long as the row does. */
interface TabRow {
  row: HTMLElement;
  sortable: Sortable;
  label: HTMLElement;
}

/** A project's name on the bar, with the parts each draw writes: a jump to the project in the list, marked when its folder is gone. */
interface ProjectLabel {
  label: HTMLElement;
  name: HTMLElement;
  mark: HTMLElement;
}

/** A project's own row, led by its name. */
interface ProjectRow extends TabRow, ProjectLabel {}

/** A group's row, with its rail, the text of its name, and its project's name, which it shows only as the folded bar's one row in All. */
interface GroupRow extends TabRow {
  rail: HTMLElement;
  name: Text;
  project: ProjectLabel;
}

/** A session's tab: the tab (tab.ts), and the marks that lead its label, which each draw writes. */
interface SessionTabEls {
  tab: TabEls;
  dot: HTMLElement;
  markGroup: HTMLElement;
  siblingMark: HTMLElement;
  worktreeMark: HTMLElement;
  clock: HTMLElement;
}

/**
 * The rows by cluster key and the tabs by token, kept from one draw to the next: the bar is drawn again whenever an open tab's status changes, and a press on a tab, or the focus on its button, survives that only while the tab stays where it is (keyed.ts).
 * A row's Sortable is made with it and let go of when it goes (`dropSortable`).
 */
const projectRows = new Keyed<ProjectRow>(
  (kept) => kept.row,
  (kept) => dropSortable(kept.sortable),
);
const groupRows = new Keyed<GroupRow>(
  (kept) => kept.row,
  (kept) => dropSortable(kept.sortable),
);
const tabEls = new Keyed<SessionTabEls>((kept) => kept.tab.el);

function buildRow(cluster: string, className: string): { row: HTMLElement; sortable: Sortable } {
  const row = document.createElement('div');
  row.className = className;
  row.dataset.cluster = cluster;
  return { row, sortable: sortableFor(row) };
}

/** A project's name, which takes you to the project in the list. */
function buildProjectLabel(root: string): ProjectLabel {
  const label = document.createElement('span');
  label.className = 'tab-row-label tab-project-label';
  const name = document.createElement('span');
  const mark = document.createElement('span');
  mark.className = 'gone-mark';
  label.append(name, mark);
  label.addEventListener('click', () => hostOf('claude').revealProject(root));
  return { label, name, mark };
}

/** Draw a project's name as it is now: what you called it, and whether its folder is gone. */
function drawProjectLabel({ label, name, mark }: ProjectLabel, root: string, view: View<'sessions' | 'tabs' | 'projectNames'>): void {
  name.textContent = projName(root, view);
  markProjectGone(root, projectGone(root, view), name, mark, 11, label);
}

/** A project's own row: its name, which shows only in All, then its tabs in no group. */
function buildProjectRow(cluster: string): ProjectRow {
  const root = cluster.slice(0, cluster.indexOf('\0'));
  return { ...buildRow(cluster, 'tab-project'), ...buildProjectLabel(root) };
}

/** A group's row: the rail and the group's label, which takes you to the group in the list, then its tabs; its project's name leads it as the folded bar's one row in All. */
function buildGroupRow(cluster: string): GroupRow {
  const split = cluster.indexOf('\0');
  const root = cluster.slice(0, split);
  const groupId = cluster.slice(split + 1);
  const rail = document.createElement('span');
  rail.className = 'tab-rail';
  const label = document.createElement('span');
  label.className = 'tab-row-label tab-group-label';
  const icon = document.createElement('span');
  icon.className = 'heading-icon';
  icon.innerHTML = layersIcon(11);
  const name = document.createTextNode('');
  label.append(icon, name);
  // The same jump as the heading's group menu: unfold, scroll the group's heading into view, and flash it.
  label.addEventListener('click', () => hostOf('claude').revealGroup(root, groupId));
  return { ...buildRow(cluster, 'tab-project tab-group-row'), rail, label, name, project: buildProjectLabel(root) };
}

/** A session's tab, built once: what it does acts on the tab by its token when pressed, since a `/clear` can hand the tab another session; what it shows each draw writes (`drawSessionTab`). */
function buildSessionTab(token: string): SessionTabEls {
  const tab = buildTab({
    select: () => {
      const held = tabOf(token);
      // Opening it, as from anywhere else, puts its project back in the strip (state/strip.ts).
      if (held) showInStrip(held.session.repoRoot);
      activateTab(token);
      const shown = tabOf(token);
      if (shown) hostOf('claude').revealSession(shown.session.id);
    },
    // Two presses, and which one this is shows in the mark: stop a running session, then close the tab it leaves behind.
    // See closeOrStop.
    // A middle click takes the same two steps: one that killed a running session outright would be the one way left to lose one by accident.
    press: () => closeOrStop(token),
    // The session's own menu, from the builder its row in the list uses, the press of the button beside it among its items, so the button is a shortcut to one of them.
    // The session list answers it (`sessionMenu`), for the session the tab holds at the click.
    menu: () => {
      const held = tabOf(token);
      return held ? hostOf('claude').sessionMenu(held.session.id, 'tab') : null;
    },
    kebabLabel: 'Session options',
  });
  const dot = document.createElement('span');
  // Toggle "read" from the tab too, rather than only from the sidebar row; the session as it is at the click, since `/clear` can hand the tab to another.
  ackOnClick(dot, () => tabOf(token)?.session.id ?? null);
  // The marks ride in their own tight cluster rather than sitting at the tab's full gap, so the leading glyphs read as one group.
  const markGroup = document.createElement('span');
  markGroup.className = 'tab-marks';
  const siblingMark = document.createElement('span');
  siblingMark.className = 'tab-sibling';
  siblingMark.innerHTML = SIBLING_ICON;
  const worktreeMark = document.createElement('span');
  worktreeMark.innerHTML = WORKTREE_ICON;
  return { tab, dot, markGroup, siblingMark, worktreeMark, clock: scheduledMark('tab-scheduled') };
}

/** Draw a session's tab as it is now: its state, its dot, its marks, its name, and its button's step. */
function drawSessionTab(tab: TabState, view: View<'statuses' | 'backgroundTasks' | 'scheduledTasks' | 'acked' | 'archived' | 'projectNames' | 'tabs' | 'activeTab'>): HTMLElement {
  const { tab: els, dot, markGroup, siblingMark, worktreeMark, clock } = tabEls.draw(tab.token, buildSessionTab);
  // 'unstartable' is the broken one — its folder is gone — and it is dimmed the way its row is, with the row's reason as its tooltip.
  const unstartable = unstartableReason(tab.session);

  applyStatus(dot, tab.session.id, view);

  // Siblings often share a title, so mark the tab too — keyed on isSibling, the same signal as the sidebar row's badge, so tab and row always agree.
  if (tab.session.isSibling) {
    const count = tab.session.siblingIds.length;
    setTooltip(siblingMark, `Has ${count} ${count === 1 ? 'sibling' : 'siblings'} in its session family`);
  }

  // A worktree session's tab gets the same branch marker as its sidebar badge, from the same rule.
  const worktree = worktreeMarkState(tab.session);
  worktreeMark.className = worktree?.left ? 'tab-worktree worktree-mark left' : 'tab-worktree worktree-mark';
  setTooltip(worktreeMark, worktree?.tooltip);

  // A task claude has scheduled, as its row and its strip row show it (scheduledmark.ts).
  const scheduled = showScheduled(clock, clockOf(view.scheduledTasks.get(tab.session.id), tab));

  const text = sessionLabel(tab.session);
  const marks = [...(tab.session.isSibling ? [siblingMark] : []), ...(worktree ? [worktreeMark] : []), ...(scheduled ? [clock] : [])];
  placeChildren(markGroup, marks);
  drawTab(els, {
    active: tab.token === view.activeTab,
    // Restored but never started: unfilled rather than marked, since it is a session waiting to be resumed, not a broken one, and clicking it is exactly what starts it.
    cold: tab.terminalId === null,
    classes: unstartable ? ['unstartable'] : [],
    text,
    tooltip: unstartable ?? `${projName(tab.session.repoRoot, view)} · ${text}`,
    // Stopping, its two pauses and its force, and closing a cold tab: the same rule the live strip's button follows — see tabButtonState.
    button: tabButtonState(tab),
    // The mark cluster is placed only when there ARE marks — an empty wrapper would still consume a gap and shift the label.
    lead: marks.length > 0 ? [dot, markGroup] : [dot],
  });
  els.el.dataset.sid = tab.session.id; // used by the Sortable onEnd to find the moved tab
  return els.el;
}

// Drag-to-reorder tabs (tab.ts).
// One Sortable per row (a project's ungrouped tabs, or one of its groups), so a drag stays inside its own cluster by construction — a tab can't be dragged into another group or project.
// Made with its row and destroyed when the row goes (`projectRows`, `groupRows`), so a draw, held while a tab is dragged, never takes one away from under the drag.
let tabDragActive = false;
/** A draw was asked for while a tab was being dragged, and is owed once it drops. */
let drawHeld = false;

function sortableFor(container: HTMLElement): Sortable {
  return sortableTabs(container, {
    start: () => {
      tabDragActive = true;
      tabbar.classList.add('dragging'); // suppress per-tab hover while reordering
    },
    end: (evt) => {
      tabDragActive = false;
      tabbar.classList.remove('dragging');
      const el = evt.item;
      const { tabs } = store.get();
      const moved = tabs.find((t) => t.session.id === el.dataset.sid);
      // Index among the destination's tabs (ignores the project label), mapped onto the tabs array.
      const newIndex = [...evt.to.querySelectorAll<HTMLElement>('.tab')].indexOf(el);
      // After the drop has finished: the new order redraws the bar and the strip, which reads its order from it too, and a draw held during the drag is owed now either way.
      queueMicrotask(() => {
        if (moved && newIndex >= 0) {
          store.set({ tabs: reorderWithinGroup(store.get().tabs, tabClusterKey, moved, newIndex) });
          persistOpenTabs();
        }
        if (drawHeld) {
          drawHeld = false;
          renderTabBar(store.get());
        }
      });
    },
  });
}
