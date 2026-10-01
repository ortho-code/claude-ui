import Sortable from 'sortablejs';
import { orderAsTabs, reorderWithinGroup, sessionLabel, stopControlState, unstartableReason } from '../../../logic';
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
 * It draws from the store (`renderTabBar`, a watcher renderer.ts registers in the order the store tells in), and asks the sidebar to show where a tab's session, project or group lives.
 */

const tabbar = document.getElementById('tabbar')!;

// The key a tab is grouped and dragged within: its project, plus its group when it has one. A drag stays inside its own cluster because each cluster is its own Sortable container.
function tabClusterKey(tab: TabState, groupOf: Record<string, string> = store.get().groupState.groupOf): string {
  return `${tab.session.repoRoot}\0${groupOf[tab.session.id] ?? ''}`;
}

// One row per cluster: a project's ungrouped tabs share the project's own row, and each of its groups gets an indented row beneath it behind the same rail the sidebar uses.
// A project view drops the project label (everything shown belongs to it) but keeps the group rows.
/** What the tab bar draws from the store. */
export type TabBarView = View<'sessions' | 'statuses' | 'acked' | 'groupState' | 'projectNames' | 'projectOrder' | 'activeProject' | 'tabs' | 'activeTab'>;

export function renderTabBar(view: TabBarView): void {
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
      const row = document.createElement('div');
      row.className = 'tab-project';
      row.dataset.cluster = `${root}\0`;
      if (!activeProject) {
        const label = document.createElement('span');
        label.className = 'tab-project-label';
        const name = document.createElement('span');
        name.textContent = projName(root, view);
        const mark = document.createElement('span');
        mark.className = 'gone-mark';
        markProjectGone(root, projectGone(root, view), name, mark, 11, label);
        label.append(name, mark);
        label.addEventListener('click', () => hostOf('claude').revealProject(root));
        row.append(label);
      }
      row.append(...loose.map((tab) => tabElement(tab, view)));
      children.push(row);
    }
    // Then one row per group that has tabs open, in registry order — the sidebar's order.
    for (const group of projectGroups(root, view)) {
      const groupTabs = byCluster.get(`${root}\0${group.id}`) ?? [];
      if (groupTabs.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'tab-project tab-group-row';
      row.dataset.cluster = `${root}\0${group.id}`;
      const rail = document.createElement('span');
      rail.className = 'tab-rail';
      const label = document.createElement('span');
      label.className = 'tab-group-label';
      const icon = document.createElement('span');
      icon.className = 'heading-icon';
      icon.innerHTML = layersIcon(11);
      label.append(icon, document.createTextNode(group.name));
      // The same jump as the heading's group menu: unfold, scroll the group's heading into view, and flash it.
      label.addEventListener('click', () => hostOf('claude').revealGroup(root, group.id));
      row.append(rail, label, ...groupTabs.map((tab) => tabElement(tab, view)));
      children.push(row);
    }
  }
  tabbar.replaceChildren(...children);
  initTabSortables();
}

/** The statuses and marks read the bar last followed, so a status change draws it only when one of its tabs' sessions is among those that changed. */
let followedStatuses: View<'statuses' | 'acked'> = { statuses: new Map(), acked: new Set() };

/** A status or a mark read changed: the bar draws again when one of its tabs' dots is among them. A watcher renderer.ts registers with the others. */
export function tabBarFollowsStatuses(view: TabBarView): void {
  const ids = statusChanges(followedStatuses, view);
  followedStatuses = { statuses: view.statuses, acked: view.acked };
  if (view.tabs.some((t) => ids.has(t.session.id))) renderTabBar(view);
}

function tabElement(tab: TabState, view: View<'statuses' | 'acked' | 'projectNames' | 'activeTab'>): HTMLElement {
  const { token } = tab;
  const el = document.createElement('div');
  // 'cold' = restored but never started. Unfilled rather than marked: it is a session waiting to be resumed, not a broken one, and clicking it is exactly what starts it.
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

  const dot = document.createElement('span');
  applyStatus(dot, view.statuses.get(tab.session.id), view.acked.has(tab.session.id));
  // Toggle "read" from the tab too, rather than only from the sidebar row; the session as it is at the click, since `/clear` can hand the tab to another.
  ackOnClick(dot, () => tabOf(token)?.session.id ?? null);

  // Siblings often share a title, so mark the tab too — keyed on isSibling, the same signal as the sidebar row's badge, so tab and row always agree.
  const siblingMark = document.createElement('span');
  siblingMark.className = 'tab-sibling';
  siblingMark.innerHTML = SIBLING_ICON;
  if (tab.session.isSibling) {
    const count = tab.session.siblingIds.length;
    setTooltip(siblingMark, `Has ${count} ${count === 1 ? 'sibling' : 'siblings'} in its session family`);
  }

  // A worktree session's tab gets the same branch marker as its sidebar badge.
  const worktreeMark = document.createElement('span');
  worktreeMark.className = 'tab-worktree';
  worktreeMark.innerHTML = WORKTREE_ICON;
  if (tab.session.worktree) setTooltip(worktreeMark, `Linked git worktree: ${tab.session.worktree}`);

  const label = document.createElement('span');
  label.className = 'tab-label';
  const text = sessionLabel(tab.session);
  label.textContent = text;
  setTooltip(label, unstartable ?? `${projName(tab.session.repoRoot, view)} · ${text}`);

  // Two presses, and which one this is shows in the mark: stop a running session, then close the tab it leaves behind. See closeOrStop.
  const close = document.createElement('button');
  close.className = 'icon-btn compact tab-close';
  // Anything but a settled cold tab: it has a process, or one is on its way, or one is on its way out.
  if (tab.terminalId !== null || tab.starting || tab.stopping) {
    // Stopping, and its two pauses, are the same rule the attention strip's button follows — see stopControlState.
    const { disabled, tooltip } = stopControlState(tab);
    close.disabled = disabled;
    close.innerHTML = stopIcon(14);
    setTooltip(close, tooltip);
  } else {
    close.innerHTML = closeIcon(14);
    setTooltip(close, 'Close tab');
  }
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeOrStop(token);
  });

  el.dataset.sid = tab.session.id; // used by the Sortable onEnd to find the moved tab
  const marks = [...(tab.session.isSibling ? [siblingMark] : []), ...(tab.session.worktree ? [worktreeMark] : [])];
  // The marks ride in their own tight cluster rather than sitting at the tab's full gap, so the leading glyphs read as one group.
  // Only added when there ARE marks — an empty wrapper would still consume a gap and shift the label.
  if (marks.length > 0) {
    const markGroup = document.createElement('span');
    markGroup.className = 'tab-marks';
    markGroup.append(...marks);
    el.append(dot, markGroup, label, close);
  } else {
    el.append(dot, label, close);
  }
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
  return el;
}

// Drag-to-reorder tabs via SortableJS.
// One Sortable per project container (the whole tab bar in a cluster row: a project's ungrouped tabs, or one of its groups), so a drag stays inside its own cluster by construction — a tab can't be dragged into another group or project.
// forceFallback uses pointer-based dragging instead of native HTML5 DnD (flaky under WSLg).
// Re-created on every renderTabBar since it rebuilds the DOM; old instances destroyed first to avoid leaks.
let tabSortables: Sortable[] = [];
let tabDragActive = false;

function initTabSortables(): void {
  for (const s of tabSortables) s.destroy();
  const containers = [...tabbar.querySelectorAll<HTMLElement>('.tab-project')];
  tabSortables = containers.map((container) =>
    Sortable.create(container, {
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
        if (!moved || newIndex < 0) return;
        // The new order redraws the bar and the strip, which reads its order from it too; after the drop has finished, since the bar's redraw destroys this very Sortable.
        queueMicrotask(() => {
          store.set({ tabs: reorderWithinGroup(store.get().tabs, tabClusterKey, moved, newIndex) });
          persistOpenTabs();
        });
      },
    }),
  );
}

// Alt-tabbing away mid-drag never delivers a pointerup, so SortableJS can leave a drag stuck. On blur, synthesise the release so it ends cleanly (dropping the tab where it currently is).
window.addEventListener('blur', () => {
  if (!tabDragActive) return;
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
