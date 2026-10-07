import Sortable from 'sortablejs';
import { fromMarkup } from '../../../dom';
import { Keyed, placeChildren, setMarkup } from '../../../keyed';
import { orderAsTabs, reorderWithinGroup, sessionLabel, stopControlState, unstartableReason, worktreeMarkState } from '../../../logic';
import { markProjectGone } from '../../../projectgone';
import { store, type TabState, type View } from '../../../state/app';
import { projName, projectGone, projectGroups, statusChanges, visibleTabs } from '../../../state/views';
import { ackOnClick, applyStatus } from '../../../statusdot';
import { closeIcon, layersIcon, SIBLING_ICON, stopIcon, WORKTREE_ICON } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { hostOf } from '../builtin';
import { activateTab, closeOrStop, persistOpenTabs, tabOf } from './terminals';
import './tab-bar.css';

/**
 * The terminal area's tab bar: a tab per open session, clustered by project and group in the order the sidebar uses, each with its status dot, its marks and its two-step close, and reordered by dragging within its cluster.
 * It draws from the store (`renderTabBar`, a watcher the terminal area registers, watch.ts), and asks the sidebar to show where a tab's session, project or group lives.
 */

/** The tab bar, built here and placed by the terminal area (index.ts). */
export const tabbar = fromMarkup(`<div id="tabbar"></div>`);

// The key a tab is grouped and dragged within: its project, plus its group when it has one.
// A drag stays inside its own cluster because each cluster is its own Sortable container.
function tabClusterKey(tab: TabState, groupOf: Record<string, string> = store.get().groupState.groupOf): string {
  return `${tab.session.repoRoot}\0${groupOf[tab.session.id] ?? ''}`;
}

// One row per cluster: a project's ungrouped tabs share the project's own row, and each of its groups gets an indented row beneath it behind the same rail the sidebar uses.
// A project view drops the project label (everything shown belongs to it) but keeps the group rows.
/** What the tab bar draws from the store. */
type TabBarView = View<'sessions' | 'statuses' | 'acked' | 'groupState' | 'projectNames' | 'projectOrder' | 'activeProject' | 'tabs' | 'activeTab'>;

export function renderTabBar(view: TabBarView): void {
  // The library owns the bar's tabs while one is dragged — it moves them, and puts its copy of the dragged one in its row — so a redraw then would undo the drag under the pointer; the drop draws what was held (`sortableFor`).
  if (tabDragActive) {
    drawHeld = true;
    return;
  }
  const { activeProject } = view;
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

  const children: HTMLElement[] = [];
  for (const root of roots) {
    // The project's own row: its label (in All) and every tab of its that is in no group.
    const loose = byCluster.get(`${root}\0`) ?? [];
    if (!activeProject || loose.length > 0) {
      const { row, label, name, mark } = projectRows.draw(`${root}\0`, buildProjectRow);
      if (!activeProject) {
        name.textContent = projName(root, view);
        markProjectGone(root, projectGone(root, view), name, mark, 11, label);
      }
      placeChildren(row, [...(activeProject ? [] : [label]), ...loose.map((tab) => drawTab(tab, view))]);
      children.push(row);
    }
    // Then one row per group that has tabs open, in registry order — the sidebar's order.
    for (const group of projectGroups(root, view)) {
      const groupTabs = byCluster.get(`${root}\0${group.id}`) ?? [];
      if (groupTabs.length === 0) continue;
      const { row, rail, label, name } = groupRows.draw(`${root}\0${group.id}`, buildGroupRow);
      name.data = group.name;
      placeChildren(row, [rail, label, ...groupTabs.map((tab) => drawTab(tab, view))]);
      children.push(row);
    }
  }
  placeChildren(tabbar, children);
  // What this draw did not draw is gone: a tab closed or out of the project on show, or a row with no tab left in it, whose Sortable goes with it.
  projectRows.sweep();
  groupRows.sweep();
  tabEls.sweep();
}

/**
 * A status or a mark read changed: the bar draws again when one of its tabs' dots is among those that changed since it last followed them (`before`).
 * A watcher the terminal area registers (watch.ts).
 */
export function tabBarFollowsStatuses(view: TabBarView, before: View<'statuses' | 'acked'>): void {
  const ids = statusChanges(before, view);
  if (view.tabs.some((t) => ids.has(t.session.id))) renderTabBar(view);
}

/** A row of the bar and its Sortable, which lives as long as the row does. */
interface TabRow {
  row: HTMLElement;
  sortable: Sortable;
  label: HTMLElement;
}

/** A project's own row, with the parts of its label each draw writes. */
interface ProjectRow extends TabRow {
  name: HTMLElement;
  mark: HTMLElement;
}

/** A group's row, with its rail and the text of its name. */
interface GroupRow extends TabRow {
  rail: HTMLElement;
  name: Text;
}

/** A tab and the parts each draw writes. */
interface TabEls {
  el: HTMLElement;
  dot: HTMLElement;
  markGroup: HTMLElement;
  siblingMark: HTMLElement;
  worktreeMark: HTMLElement;
  label: HTMLElement;
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

/** A project's own row: its label, which takes you to the project in the list and shows only in All, then its tabs in no group. */
function buildProjectRow(cluster: string): ProjectRow {
  const root = cluster.slice(0, cluster.indexOf('\0'));
  const label = document.createElement('span');
  label.className = 'tab-project-label';
  const name = document.createElement('span');
  const mark = document.createElement('span');
  mark.className = 'gone-mark';
  label.append(name, mark);
  label.addEventListener('click', () => hostOf('claude').revealProject(root));
  return { ...buildRow(cluster, 'tab-project'), label, name, mark };
}

/** A group's row: the rail and the group's label, which takes you to the group in the list, then its tabs. */
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
  return { ...buildRow(cluster, 'tab-project tab-group-row'), rail, label, name };
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
  // Two presses, and which one this is shows in the mark: stop a running session, then close the tab it leaves behind.
  // See closeOrStop.
  const close = document.createElement('button');
  close.className = 'icon-btn compact tab-close';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeOrStop(token);
  });
  el.addEventListener('click', () => {
    activateTab(token);
    const shown = tabOf(token);
    if (shown) hostOf('claude').revealSession(shown.session.id);
  });
  el.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      // The same two steps as the button: a middle click that killed a running session outright would be the one way left to lose one by accident.
      closeOrStop(token);
    }
  });
  return { el, dot, markGroup, siblingMark, worktreeMark, label, close };
}

/** Draw a tab as it is now: its state, its dot, its marks, its name, and its button's step. */
function drawTab(tab: TabState, view: View<'statuses' | 'acked' | 'projectNames' | 'activeTab'>): HTMLElement {
  const { el, dot, markGroup, siblingMark, worktreeMark, label, close } = tabEls.draw(tab.token, buildTab);
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

  applyStatus(dot, view.statuses.get(tab.session.id), view.acked.has(tab.session.id));

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

  // Anything but a settled cold tab: it has a process, or one is on its way, or one is on its way out.
  if (tab.terminalId !== null || tab.starting || tab.stopping) {
    // Stopping, its two pauses and its force, are the same rule the live strip's button follows — see stopControlState.
    const { disabled, tooltip, force } = stopControlState(tab);
    close.disabled = disabled;
    setMarkup(close, stopIcon(14, force));
    setTooltip(close, tooltip);
  } else {
    close.disabled = false;
    setMarkup(close, closeIcon(14));
    setTooltip(close, 'Close tab');
  }

  el.dataset.sid = tab.session.id; // used by the Sortable onEnd to find the moved tab
  const marks = [...(tab.session.isSibling ? [siblingMark] : []), ...(worktree ? [worktreeMark] : [])];
  placeChildren(markGroup, marks);
  // The mark cluster is placed only when there ARE marks — an empty wrapper would still consume a gap and shift the label.
  placeChildren(el, marks.length > 0 ? [dot, markGroup, label, close] : [dot, label, close]);
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
    // The close button is not a drag handle.
    // Without this, a mousedown on it starts a potential drag, and `forceFallback` then calls preventDefault to take over pointer handling — after which Chromium on macOS never synthesises the click, so closing a tab silently did nothing there.
    // It survived on Linux, which is why this only appeared once the app reached a Mac.
    // preventOnFilter: false is the half that matters: the default (true) still preventDefaults on the filtered element, which is the very thing that swallows the click.
    filter: '.tab-close',
    preventOnFilter: false,
    forceFallback: true,
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
