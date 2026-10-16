import Sortable from 'sortablejs';
import { element, fromMarkup } from '../../../dom';
import { drawFoldChevron, foldChevron } from '../../../fold-chevron';
import { Keyed, placeChildren, setMarkup } from '../../../keyed';
import { orderAsTabs, reorderWithinGroup, sessionLabel, strongestNudge, tabButtonState, unstartableReason, worktreeMarkState } from '../../../logic';
import { kebabButton, openMenu, type MenuItem } from '../../../menu';
import { markProjectGone } from '../../../projectgone';
import { store, type TabState, type View } from '../../../state/app';
import { showInStrip } from '../../../state/strip';
import { projName, projectGone, projectGroups, sessionNudge, statusChanges, visibleTabs } from '../../../state/views';
import { ackOnClick, applyStatus, badgeClass } from '../../../statusdot';
import { layersIcon, SIBLING_ICON, tabButtonIcon, WORKTREE_ICON } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { setUnavailable, unavailable } from '../../../unavailable';
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
 * Its dot speaks for the tabs the fold hides, as a panel's icon on a rail does for the panel.
 * Folded is kept for the next launch (`tabBarExpanded`, claude/stored-view.ts).
 * Placed under the bar by the terminal area (index.ts).
 */
export const tabbarEdge = fromMarkup(`<div id="tabbar-edge" hidden></div>`);
const fold = foldChevron('horizontal');
fold.id = 'tabbar-fold';
fold.classList.add('dotted-icon');
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
type TabBarView = View<'sessions' | 'statuses' | 'backgroundTasks' | 'acked' |'groupState' | 'projectNames' | 'projectOrder' | 'activeProject' | 'tabs' | 'activeTab' | 'tabBarExpanded'>;

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
  for (const root of roots) {
    // The project's own row: its label (in All) and every tab of its that is in no group.
    const loose = byCluster.get(`${root}\0`) ?? [];
    if ((!activeProject || loose.length > 0) && drawn(`${root}\0`)) {
      const projectRow = projectRows.draw(`${root}\0`, buildProjectRow);
      if (!activeProject) drawProjectLabel(projectRow, root, view);
      placeChildren(projectRow.row, [...(activeProject ? [] : [projectRow.label]), ...loose.map((tab) => drawTab(tab, view))]);
      children.push(projectRow.row);
    }
    // Then one row per group that has tabs open, in registry order — the sidebar's order.
    for (const group of projectGroups(root, view)) {
      const groupTabs = byCluster.get(`${root}\0${group.id}`) ?? [];
      if (groupTabs.length === 0 || !drawn(`${root}\0${group.id}`)) continue;
      const { row, rail, label, name, project } = groupRows.draw(`${root}\0${group.id}`, buildGroupRow);
      name.data = group.name;
      // Folded in All, the row is the bar's only one, and nothing else on it says which project it is: its project's name goes in front, as the project's own row has it.
      const named = !activeProject && !tabBarExpanded;
      if (named) drawProjectLabel(project, root, view);
      placeChildren(row, [...(named ? [project.label] : []), rail, label, ...groupTabs.map((tab) => drawTab(tab, view))]);
      children.push(row);
    }
  }
  placeChildren(tabbar, children);
  // The line and its fold go with the last tab, as the live strip goes when it has nothing: an empty bar has nothing to fold, and nothing to sit on a line.
  tabbarEdge.hidden = shown.length === 0;
  if (shown.length > 0) drawFold(tabBarExpanded, kept ? shown.filter((tab) => !kept.items.includes(tab)) : [], view);
  // What this draw did not draw is gone: a tab closed or out of the project on show, or a row with no tab left in it, whose Sortable goes with it.
  projectRows.sweep();
  groupRows.sweep();
  tabEls.sweep();
}

/**
 * The fold as the bar now is: which way it points (up while the bar is open, the way its edge moves as it folds), what it says, and its dot, the strongest nudge of the tabs it hides (`hidden`), so one waiting out of sight still says so; a read tab's waiting or idle counts as nothing, as it does in every roll-up.
 * It always folds the bar to one row, whatever is on show, so that is what it says.
 */
function drawFold(expanded: boolean, hidden: readonly TabState[], view: View<'statuses' | 'acked'>): void {
  drawFoldChevron(fold, expanded ? 'up' : 'down', expanded ? 'Fold the tab bar to one row' : 'Unfold the tab bar');
  fold.setAttribute('aria-expanded', String(expanded));
  const badge = strongestNudge(hidden.map((tab) => sessionNudge(tab.session.id, view)));
  foldDot.className = badgeClass(badge);
  foldDot.hidden = badge === null;
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

/** A tab and the parts each draw writes. */
interface TabEls {
  el: HTMLElement;
  dot: HTMLElement;
  markGroup: HTMLElement;
  siblingMark: HTMLElement;
  worktreeMark: HTMLElement;
  label: HTMLElement;
  kebab: HTMLButtonElement;
  close: HTMLButtonElement;
}

/**
 * The rows by cluster key and the tabs by token, kept from one draw to the next: the bar is drawn again whenever an open tab's status changes, and a press on a tab, or the focus on its button, survives that only while the tab stays where it is (keyed.ts).
 * A row's Sortable is made with it and destroyed when it goes.
 */
const projectRows = new Keyed<ProjectRow>(
  (kept) => kept.row,
  (kept) => kept.sortable.destroy(),
);
const groupRows = new Keyed<GroupRow>(
  (kept) => kept.row,
  (kept) => kept.sortable.destroy(),
);
const tabEls = new Keyed<TabEls>((kept) => kept.el);

function buildRow(cluster: string, className: string): { row: HTMLElement; sortable: Sortable } {
  const row = document.createElement('div');
  row.className = className;
  row.dataset.cluster = cluster;
  return { row, sortable: sortableFor(row) };
}

/** A project's name, which takes you to the project in the list. */
function buildProjectLabel(root: string): ProjectLabel {
  const label = document.createElement('span');
  label.className = 'tab-project-label';
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
  label.className = 'tab-group-label';
  const icon = document.createElement('span');
  icon.className = 'heading-icon';
  icon.innerHTML = layersIcon(11);
  const name = document.createTextNode('');
  label.append(icon, name);
  // The same jump as the heading's group menu: unfold, scroll the group's heading into view, and flash it.
  label.addEventListener('click', () => hostOf('claude').revealGroup(root, groupId));
  return { ...buildRow(cluster, 'tab-project tab-group-row'), rail, label, name, project: buildProjectLabel(root) };
}

/** A tab, built once: what it does acts on the tab by its token when pressed, since a `/clear` can hand the tab another session; what it shows each draw writes (`drawTab`). */
function buildTab(token: string): TabEls {
  const el = document.createElement('div');
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
  const label = document.createElement('span');
  label.className = 'tab-label';
  // The session's own menu, the one its row in the list has, Pause and Unpause with it: everything but the button beside it, which stays in sight.
  // The session list answers it (`sessionMenu`), for the session the tab holds at the click.
  const menu = (): MenuItem[] | null => {
    const tab = tabOf(token);
    return tab ? hostOf('claude').sessionMenu(tab.session.id) : null;
  };
  const kebab = kebabButton('compact tab-kebab abuts', 'Session options', menu);
  // Two presses, and which one this is shows in the mark: stop a running session, then close the tab it leaves behind.
  // See closeOrStop.
  const close = document.createElement('button');
  close.className = 'icon-btn compact tab-close';
  close.addEventListener('click', (event) => {
    // A press on the button is never a press on its tab, even when it cannot act.
    event.stopPropagation();
    if (unavailable(close)) return;
    closeOrStop(token);
  });
  el.addEventListener('click', () => {
    const tab = tabOf(token);
    // Opening it, as from anywhere else, puts its project back in the strip (state/strip.ts).
    if (tab) showInStrip(tab.session.repoRoot);
    activateTab(token);
    const shown = tabOf(token);
    if (shown) hostOf('claude').revealSession(shown.session.id);
  });
  // A right-click on the tab opens the same menu, from its kebab, so the menu sits where it always does.
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const items = menu();
    if (items) openMenu(kebab, items);
  });
  el.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      // The same two steps as the button: a middle click that killed a running session outright would be the one way left to lose one by accident.
      closeOrStop(token);
    }
  });
  return { el, dot, markGroup, siblingMark, worktreeMark, label, kebab, close };
}

/** Draw a tab as it is now: its state, its dot, its marks, its name, and its button's step. */
function drawTab(tab: TabState, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'projectNames' | 'tabs' | 'activeTab'>): HTMLElement {
  const { el, dot, markGroup, siblingMark, worktreeMark, label, kebab, close } = tabEls.draw(tab.token, buildTab);
  // 'cold' = restored but never started.
  // Unfilled rather than marked: it is a session waiting to be resumed, not a broken one, and clicking it is exactly what starts it.
  // 'unstartable' is the broken one — its folder is gone — and it is dimmed the way its row is, with the row's reason as its tooltip.
  const unstartable = unstartableReason(tab.session);
  el.className = [
    'tab',
    tab.token === view.activeTab ? 'active' : '',
    tab.terminalId === null ? 'cold' : '',
    unstartable ? 'unstartable' : '',
  ]
    .filter(Boolean)
    .join(' ');

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

  const text = sessionLabel(tab.session);
  label.textContent = text;
  setTooltip(label, unstartable ?? `${projName(tab.session.repoRoot, view)} · ${text}`);

  // Stopping, its two pauses and its force, and closing a cold tab: the same rule the live strip's button follows — see tabButtonState.
  const { disabled, tooltip, mark } = tabButtonState(tab);
  setUnavailable(close, disabled ? tooltip : null, tooltip);
  setMarkup(close, tabButtonIcon(mark, 14));

  el.dataset.sid = tab.session.id; // used by the Sortable onEnd to find the moved tab
  const marks = [...(tab.session.isSibling ? [siblingMark] : []), ...(worktree ? [worktreeMark] : [])];
  placeChildren(markGroup, marks);
  // The mark cluster is placed only when there ARE marks — an empty wrapper would still consume a gap and shift the label.
  placeChildren(el, marks.length > 0 ? [dot, markGroup, label, kebab, close] : [dot, label, kebab, close]);
  return el;
}

// Drag-to-reorder tabs via SortableJS.
// One Sortable per row (a project's ungrouped tabs, or one of its groups), so a drag stays inside its own cluster by construction — a tab can't be dragged into another group or project.
// forceFallback uses pointer-based dragging instead of native HTML5 DnD (flaky under WSLg).
// Made with its row and destroyed when the row goes (`projectRows`, `groupRows`), so a draw, held while a tab is dragged, never takes one away from under the drag.
let tabDragActive = false;
/** A draw was asked for while a tab was being dragged, and is owed once it drops. */
let drawHeld = false;

function sortableFor(container: HTMLElement): Sortable {
  return Sortable.create(container, {
    draggable: '.tab', // never the project label
    // The tab's buttons, its close and its kebab, are not drag handles.
    // Without this, a mousedown on one starts a potential drag, and `forceFallback` then calls preventDefault to take over pointer handling — after which Chromium on macOS never synthesises the click, so closing a tab silently did nothing there.
    // It survived on Linux, which is why this only appeared once the app reached a Mac.
    // preventOnFilter: false is the half that matters: the default (true) still preventDefaults on the filtered element, which is the very thing that swallows the click.
    filter: '.tab-close, .tab-kebab',
    preventOnFilter: false,
    forceFallback: true,
    // A press that wanders a pixel or two is a click: with Sortable's default of 0, any movement at all started a drag, and the tab was never chosen.
    fallbackTolerance: 4,
    animation: 0,
    ghostClass: 'tab-ghost',
    onStart: () => {
      tabDragActive = true;
      tabbar.classList.add('dragging'); // suppress per-tab hover while reordering
    },
    onEnd: (evt) => {
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

// Alt-tabbing away mid-drag never delivers a pointerup, so SortableJS can leave a drag stuck.
// On blur, synthesise the release so it ends cleanly (dropping the tab where it currently is).
window.addEventListener('blur', () => {
  if (!tabDragActive) return;
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
