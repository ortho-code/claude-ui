import { byId, fromMarkup } from '../../../dom';
import { Keyed, placeChildren } from '../../../keyed';
import type { NudgeStatus, SwitcherModel } from '../../../logic';
import { markProjectGone } from '../../../projectgone';
import { store, type View } from '../../../state/app';
import { setProjectOnShow } from '../../../state/project';
import { switcherModel, switcherPool } from '../../../state/views';
import { badgeClass } from '../../../statusdot';
import { chevronIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { hostOf } from '../builtin';
import '../../../menu-row.css';
import '../../../popover.css';
import './switcher.css';

/**
 * The project switcher, the sidebar's title: the project on show, badged with the roll-up of every project's statuses, over a popover listing every project to choose.
 * Choosing one selects it (`selectProject`): the project on show and its fold in the store, and the terminal area asked to show it; the list follows the store.
 */

/** The switcher, built here and placed by the sidebar (index.ts). */
export const switcherEl = fromMarkup(`
  <div id="project-switcher">
    <button id="switcher-current" type="button" aria-haspopup="true" aria-expanded="false" data-tooltip="Switch project">
      <span id="switcher-name">All</span>
      <span id="switcher-gone" class="gone-mark" hidden></span>
      <span class="switcher-right">
        <span id="switcher-badge" class="nudge" hidden></span>
        <span class="switcher-chev" aria-hidden="true"></span>
      </span>
    </button>
    <div id="switcher-popover" class="popover attach-top" hidden>
      <div id="switcher-list" role="menu"></div>
    </div>
  </div>`);
const switcherCurrent = byId(switcherEl, 'switcher-current', HTMLButtonElement);
const switcherName = byId(switcherEl, 'switcher-name');
const switcherGone = byId(switcherEl, 'switcher-gone');
const switcherBadge = byId(switcherEl, 'switcher-badge');
const switcherPopover = byId(switcherEl, 'switcher-popover');
const switcherList = byId(switcherEl, 'switcher-list');

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

  placeChildren(switcherList, [
    drawItem('All', null, model.all.count, null, activeProject === null, false),
    ...model.projects.map((f) => drawItem(f.name, f.repoRoot, f.count, f.badge, f.repoRoot === activeProject, !f.rootExists)),
  ]);
  items.sweep();
}

/** An entry and the parts each render writes. */
interface SwitcherItem {
  btn: HTMLButtonElement;
  label: HTMLElement;
  mark: HTMLElement;
  dot: HTMLElement;
  cnt: HTMLElement;
}

/**
 * The entries by repo root, All's by the empty key, kept from one render to the next: the switcher is drawn again whenever any session's status changes, and a press on an entry or the focus on it survives that only while the entry stays where it is (keyed.ts).
 */
const items = new Keyed<SwitcherItem>((item) => item.btn);

/** An entry, built once: choosing it selects its project, or All for the empty key. */
function buildItem(key: string): SwitcherItem {
  const repoRoot = key || null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  const label = document.createElement('span');
  label.className = 'switcher-item-name';
  const mark = document.createElement('span');
  mark.className = 'gone-mark';
  const dot = document.createElement('span');
  const cnt = document.createElement('span');
  cnt.className = 'switcher-item-count';
  btn.append(label, mark, dot, cnt);
  btn.addEventListener('click', () => selectProject(repoRoot));
  return { btn, label, mark, dot, cnt };
}

/** Draw a project's entry, or All's with a null `repoRoot`, as it is now. */
function drawItem(name: string, repoRoot: string | null, count: number, badge: NudgeStatus, active: boolean, gone: boolean): HTMLElement {
  const { btn, label, mark, dot, cnt } = items.draw(repoRoot ?? '', buildItem);
  btn.className = active ? 'menu-row switcher-item active' : 'menu-row switcher-item';
  label.textContent = name;
  // The full path on hover, since the row shows only the last segment; a dead project's reason carries the path too.
  if (repoRoot) markProjectGone(repoRoot, gone, label, mark, 13, btn);
  else {
    mark.hidden = true;
    setTooltip(btn, 'All projects');
  }
  dot.className = badgeClass(badge);
  cnt.textContent = String(count);
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
