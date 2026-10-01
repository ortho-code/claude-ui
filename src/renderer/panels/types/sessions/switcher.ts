import type { NudgeStatus, SwitcherModel } from '../../../logic';
import { markProjectGone } from '../../../projectgone';
import { store, type View } from '../../../state/app';
import { setProjectOnShow } from '../../../state/project';
import { switcherModel, switcherPool } from '../../../state/views';
import { badgeClass } from '../../../statusdot';
import { chevronIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { hostOf } from '../builtin';
// The sidebar's markup, which holds the switcher's elements: built before this module reads them.
import './index';
import './switcher.css';

/**
 * The project switcher, the sidebar's title: the project on show, badged with the roll-up of every project's statuses, over a popover listing every project to choose.
 * Choosing one selects it (`selectProject`): the project on show and its fold in the store, and the terminal area asked to show it; the list follows the store.
 */

const switcherEl = document.getElementById('project-switcher')!;
const switcherCurrent = document.getElementById('switcher-current') as HTMLButtonElement;
const switcherName = document.getElementById('switcher-name')!;
const switcherGone = document.getElementById('switcher-gone')!;
const switcherBadge = document.getElementById('switcher-badge')!;
const switcherPopover = document.getElementById('switcher-popover')!;

// Update the switcher header + popover from every project's roll-up (`switcherModel`), which is independent of search/project so you can always navigate.
function renderSwitcher(model: SwitcherModel, view: View<'activeProject'>): void {
  const { activeProject } = view;
  const active = activeProject ? model.projects.find((f) => f.repoRoot === activeProject) : null;
  switcherName.textContent = active ? active.name : 'All';
  // The title keeps "Switch project" as its tooltip; only the mark says why.
  markProjectGone(activeProject ?? '', active ? !active.rootExists : false, switcherName, switcherGone, 14);

  // Header nudge: the overall roll-up across ALL projects (incl. the active one and busy), so any attention is visible at a glance even when scoped to a project or scrolled down a long list.
  const headerBadge = model.all.badge;
  switcherBadge.className = badgeClass(headerBadge);
  switcherBadge.hidden = !headerBadge;
  setTooltip(switcherBadge, headerBadge ? `A project is ${headerBadge}` : null);

  switcherPopover.replaceChildren(
    switcherItem('All', null, model.all.count, null, activeProject === null, false),
    ...model.projects.map((f) => switcherItem(f.name, f.repoRoot, f.count, f.badge, f.repoRoot === activeProject, !f.rootExists)),
  );
}

function switcherItem(name: string, repoRoot: string | null, count: number, badge: NudgeStatus, active: boolean, gone: boolean): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = active ? 'switcher-item active' : 'switcher-item';
  btn.setAttribute('role', 'menuitem');

  const label = document.createElement('span');
  label.className = 'switcher-item-name';
  label.textContent = name;

  // The full path on hover, since the row shows only the last segment; a dead project's reason carries the path too.
  const mark = document.createElement('span');
  mark.className = 'gone-mark';
  if (repoRoot) markProjectGone(repoRoot, gone, label, mark, 13, btn);
  else {
    mark.hidden = true;
    setTooltip(btn, 'All projects');
  }

  const dot = document.createElement('span');
  dot.className = badgeClass(badge);

  const cnt = document.createElement('span');
  cnt.className = 'switcher-item-count';
  cnt.textContent = String(count);

  btn.append(label, mark, dot, cnt);
  btn.addEventListener('click', () => selectProject(repoRoot));
  return btn;
}

/** Select a project, or All with null: what choosing one here does, and the sidebar's answer to the `selectProject` ask. */
export function selectProject(repoRoot: string | null): void {
  closeSwitcher();
  // Full workspace switch: the terminal area moves to this project too, in the same change, so every surface that honours the selection is told once, with the project and its tab together.
  store.batch(() => {
    setProjectOnShow(repoRoot);
    hostOf('sessions').showProject(repoRoot);
  });
}

/**
 * A project with no sessions left cannot stay selected: fall back to All exactly as picking it does, the tab bar and the tab on show included.
 * Setting the scope alone once left the bar on the old project's tabs while the list and the switcher said All.
 * Told on what the switcher's projects are made of.
 */
export function fallBackIfEmptied(view: View<'sessions' | 'archived' | 'pendingDeletes' | 'activeProject' | 'tabs'>): void {
  const { activeProject } = view;
  if (activeProject !== null && !switcherPool(view).some((s) => s.repoRoot === activeProject)) selectProject(null);
}

function openSwitcher(): void {
  switcherPopover.hidden = false;
  switcherCurrent.setAttribute('aria-expanded', 'true');
  document.addEventListener('click', onSwitcherOutside, true);
}

function closeSwitcher(): void {
  switcherPopover.hidden = true;
  switcherCurrent.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onSwitcherOutside, true);
}

function onSwitcherOutside(event: MouseEvent): void {
  if (!switcherEl.contains(event.target as Node)) closeSwitcher();
}

switcherCurrent.addEventListener('click', () => {
  if (switcherPopover.hidden) openSwitcher();
  else closeSwitcher();
});

// The caret, from the same chevron as every other fold in the app.
switcherCurrent.querySelector('.switcher-chev')!.innerHTML = chevronIcon('down', 11);

/** What the switcher draws from the store. */
type SwitcherView = View<'sessions' | 'statuses' | 'acked' | 'archived' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'activeProject' | 'tabs'>;

/**
 * The switcher follows the store: every project's count and roll-up, and the project on show.
 * It lists every project, independent of the search and the project on show, so you can always navigate; a project with none left has already fallen back to All (`fallBackIfEmptied`).
 * A watcher the sidebar registers (watch.ts), as it does `fallBackIfEmptied`.
 */
export function refreshSwitcher(view: SwitcherView): void {
  renderSwitcher(switcherModel(view), view);
}
