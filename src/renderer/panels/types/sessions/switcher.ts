import { byId, fromMarkup } from '../../../ui/dom';
import { Keyed, placeChildren } from '../../../ui/keyed';
import { elsewhere, type SwitcherModel } from '../../../rules/session-list';
import { rollUpWords, type RollUp } from '../../../status/rollup';
import { markProjectGone } from '../../../status/project-gone';
import { store, type View } from '../../../state/app';
import { setProjectOnShow } from '../../../state/project';
import { listedProjects, strengthNow, switcherModel } from '../../../state/views';
import { badgeClass, stateClass } from '../../../status/status-dot';
import { chevronIcon } from '../../../ui/svg';
import { setTooltip } from '../../../ui/tooltip';
import { hostOf } from '../builtin';
import '../../../ui/card.css';
import '../../../ui/menu-row.css';
import '../../../ui/popover.css';
import './switcher.css';

/**
 * The project switcher, the sidebar's title: the project on show, badged with what asks for you in the other projects, over a popover listing every project to choose, each with its own.
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
function renderSwitcher(model: SwitcherModel, view: View<'activeProject' | 'settings' | 'needsYouTypes'>): void {
  const { activeProject } = view;
  const active = activeProject ? model.projects.find((f) => f.repoRoot === activeProject) : null;
  switcherName.textContent = active ? active.name : 'All';
  // The title keeps "Switch project" as its tooltip; only the mark says why.
  markProjectGone(activeProject ?? '', active ? !active.rootExists : false, switcherName, switcherGone, 14);

  const outside = elsewhere(model, activeProject, strengthNow(view));
  drawRollUp(switcherBadge, outside, rollUpWords(outside, activeProject === null ? 'here' : 'elsewhere'));

  placeChildren(switcherList, [
    drawItem('All', null, model.all.count, model.all, activeProject === null, false),
    ...model.projects.map((f) => drawItem(f.name, f.repoRoot, f.count, f, f.repoRoot === activeProject, !f.rootExists)),
  ]);
  items.sweep();
}

/**
 * A roll-up as the switcher draws it, on its title and on each entry alike: the count of what asks for you, in the colour of the strongest of it; else the busy dot, without a number, while something works; else nothing.
 * A count rather than a dot, so how much is waiting reads without opening anything (decided 2026-11-08).
 */
function drawRollUp(el: HTMLElement, rollUp: RollUp, words: string | null): void {
  const strongest = rollUp.asking > 0 ? rollUp.badge : null;
  el.className = `switcher-roll-up ${strongest ? `switcher-asking ${stateClass(strongest)}` : badgeClass(rollUp.working > 0 ? 'busy' : null)}`;
  el.textContent = strongest ? String(rollUp.asking) : '';
  el.hidden = !strongest && rollUp.working === 0;
  setTooltip(el, words);
}

/** An entry and the parts each render writes: `rollUp` is its project's roll-up as `drawRollUp` draws it. */
interface SwitcherItem {
  btn: HTMLButtonElement;
  label: HTMLElement;
  mark: HTMLElement;
  rollUp: HTMLElement;
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
  const rollUp = document.createElement('span');
  const cnt = document.createElement('span');
  cnt.className = 'switcher-item-count';
  const end = document.createElement('span');
  end.className = 'switcher-item-end';
  end.append(rollUp, cnt);
  btn.append(label, mark, end);
  btn.addEventListener('click', () => selectProject(repoRoot));
  return { btn, label, mark, rollUp, cnt };
}

/** Draw a project's entry, or All's with a null `repoRoot`, as it is now. */
function drawItem(name: string, repoRoot: string | null, count: number, sessions: RollUp, active: boolean, gone: boolean): HTMLElement {
  const { btn, label, mark, rollUp, cnt } = items.draw(repoRoot ?? '', buildItem);
  btn.className = active ? 'menu-row switcher-item active' : 'menu-row switcher-item';
  label.textContent = name;
  // The full path on hover, since the row shows only the last segment; a dead project's reason carries the path too.
  if (repoRoot) markProjectGone(repoRoot, gone, label, mark, 13, btn);
  else {
    mark.hidden = true;
    setTooltip(btn, 'All projects');
  }
  drawRollUp(rollUp, sessions, rollUpWords(sessions, 'here'));
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
 * A project the switcher no longer lists — no session left, finished ones included — cannot stay selected: fall back to All exactly as picking it does, the tab bar and the tab on show included.
 * One whose sessions are all finished is still listed, so finishing the last of them leaves you where you are.
 * Setting the scope alone once left the bar on the old project's tabs while the list and the switcher said All.
 * Told on what the switcher's projects are made of.
 */
export function fallBackIfEmptied(view: View<'sessions' | 'finished' | 'pendingDeletes' | 'activeProject' | 'tabs'>): void {
  const { activeProject } = view;
  if (activeProject !== null && !listedProjects(view).has(activeProject)) selectProject(null);
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
type SwitcherView = View<'sessions' | 'statuses' | 'acked' | 'needsYou' | 'setAside' | 'finished' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'activeProject' | 'tabs' | 'settings' | 'needsYouTypes'>;

/**
 * The switcher follows the store: every project's count and roll-up, and the project on show.
 * It lists every project, independent of the search and the project on show, so you can always navigate, a project whose sessions are all finished among them; a project with none left has already fallen back to All (`fallBackIfEmptied`).
 * A watcher the sidebar registers (watch.ts), as it does `fallBackIfEmptied`.
 */
export function refreshSwitcher(view: SwitcherView): void {
  renderSwitcher(switcherModel(view), view);
}
