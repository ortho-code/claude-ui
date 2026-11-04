import type { SessionSummary } from '../../../../shared/types';
import { fromMarkup, byId } from '../../../dom';
import { leaveAction, momentLabel, sessionLabel } from '../../../logic';
import { openMenu } from '../../../menu';
import { store, type View } from '../../../state/app';
import { endBulk, tickAll, tickRun, toggleTick } from '../../../state/bulk';
import { clearLater, markLater } from '../../../state/later';
import { leaveTab, tabWith } from '../../../state/views';
import { strokeIcon } from '../../../svg';
import { headingTick, tickedOnShow } from '../../../ticks';
import { showToast } from '../../../toast';
import { setUnavailable, unavailable } from '../../../unavailable';
import { hostOf } from '../builtin';
import { laterChoices, moveToGroupItems } from './actions';
import { container, currentByKey } from './drawn';
import './bulk.css';

/**
 * SELECTING SEVERAL (docs/architecture.md § Selecting several): the list's bulk mode, drawn — a box on every row and heading, the line under the header that says how many are ticked, with Done, and the bar at the list's foot whose acts take every ticked row on show.
 * The mode itself is the store's (`bulk`, state/bulk.ts); this draws it and answers its presses, and each act goes through the same write a session's menu makes, given every ticked key.
 */

export const bulkLine = fromMarkup(`
  <div id="bulk-line" hidden>
    <span class="bulk-title">Select</span>
    <span class="bulk-count"></span>
    <button id="bulk-done" type="button">Done</button>
  </div>`);
export const bulkBar = fromMarkup(`
  <div id="bulk-bar" hidden>
    <button type="button" data-act="archive">Archive</button>
    <button type="button" data-act="later">Later</button>
    <button type="button" data-act="move">Move to group</button>
    <button type="button" data-act="stop">Stop</button>
    <button type="button" data-act="close">Close tab</button>
  </div>`);

const count = bulkLine.querySelector<HTMLElement>('.bulk-count')!;
const act = (name: string): HTMLButtonElement => bulkBar.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)!;

/** The tick a row's and a heading's box draws when on; a dash for a heading with some of its rows ticked. */
const TICK_ICON = strokeIcon(10, '<path d="M3.5 8.2 6.6 11.2 12.5 4.8" />', 1.8);
const SOME_ICON = strokeIcon(10, '<path d="M4 8h8" />', 1.8);

/** A box, for a row or a heading, drawn only in bulk mode (bulk.css). */
export function tickBox(): HTMLElement {
  const box = document.createElement('span');
  box.className = 'tick';
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-checked', 'false');
  return box;
}

/** The keys of the rows drawn, in the order drawn: what a Shift+press ticks a run of, and what the bar acts on of what is ticked. */
function drawnKeys(scope: ParentNode = container): string[] {
  return [...scope.querySelectorAll<HTMLElement>('.session')].map((row) => row.dataset.key ?? '').filter(Boolean);
}

/** The ticked rows on show, in the order drawn (`tickedOnShow`): what the line counts and the bar acts on. */
function ticked(): string[] {
  const { bulk } = store.get();
  return bulk ? tickedOnShow(drawnKeys(), bulk.ticked) : [];
}

/** A press on a row in bulk mode: a Shift+press ticks the run from the row last pressed, any other ticks or unticks it. */
export function pressRowInBulk(key: string, shift: boolean): void {
  if (shift) tickRun(drawnKeys(), key);
  else toggleTick(key);
}

/** A press on a heading's box: every row under it ticked, or all of them unticked when every one already is. */
export function pressHeadingBox(section: HTMLElement): void {
  const { bulk } = store.get();
  if (!bulk) return;
  const keys = drawnKeys(section);
  tickAll(keys, headingTick(keys, bulk.ticked) !== 'all');
}

/** The rows under a heading, for its menu's Select sessions…, which ticks them. */
export function rowsUnder(section: HTMLElement): string[] {
  return drawnKeys(section);
}

function drawBox(box: Element | null, state: 'all' | 'some' | 'none'): void {
  if (!(box instanceof HTMLElement)) return;
  box.classList.toggle('on', state === 'all');
  box.classList.toggle('some', state === 'some');
  box.setAttribute('aria-checked', state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false');
  const markup = state === 'all' ? TICK_ICON : state === 'some' ? SOME_ICON : '';
  if (box.innerHTML !== markup) box.innerHTML = markup;
}

/** The sessions behind keys, as the list last drew them. */
const sessionsOf = (keys: readonly string[]): SessionSummary[] => keys.flatMap((key) => currentByKey.get(key) ?? []);

/**
 * Bulk mode as the store has it, drawn over the list as drawn: the mode's class on the list, every box, the line's count and which acts can do something now, each act that cannot saying why (`setUnavailable`).
 * Called by its watcher and by every draw of the list, which may have drawn rows the boxes do not know yet.
 */
export function showBulk(view: View<'bulk' | 'tabs'>): void {
  const on = view.bulk !== null;
  container.classList.toggle('bulk', on);
  bulkLine.hidden = !on;
  bulkBar.hidden = !on;
  if (!view.bulk) return;
  const set = view.bulk.ticked;
  for (const row of container.querySelectorAll<HTMLElement>('.session')) drawBox(row.querySelector(':scope > .tick'), set.has(row.dataset.key ?? '') ? 'all' : 'none');
  for (const section of container.querySelectorAll<HTMLElement>('section.project, section.group')) drawBox(section.querySelector(':scope > .section-heading > .tick'), headingTick(drawnKeys(section), set));
  const keys = tickedOnShow(drawnKeys(), set);
  count.textContent = `${keys.length} ticked`;
  const none = keys.length === 0 ? 'Nothing is ticked' : null;
  setUnavailable(act('archive'), none ?? (keys.some((key) => archivable(key, view)) ? null : 'Every ticked session is starting'), 'Archive every ticked session');
  setUnavailable(act('later'), none, 'Set every ticked session aside for later');
  const projects = new Set(sessionsOf(keys).map((s) => s.repoRoot));
  setUnavailable(act('move'), none ?? (projects.size > 1 ? 'The ticked sessions are in more than one project' : null), 'Move every ticked session to a group');
  setUnavailable(act('stop'), none ?? (keys.some((key) => stoppable(key, view)) ? null : 'None of the ticked sessions runs, or each is stopping already'), 'Stop every ticked session that runs');
  const close = keys.some((key) => tabWith(key, view)) ? 'None of the ticked sessions has a tab to close now' : 'None of the ticked sessions has a tab';
  setUnavailable(act('close'), none ?? (keys.some((key) => closable(key, view)) ? null : close), 'Close the tab of every ticked session');
}

/** Whether a session's tab offers a leave item as itself, not as a force, nor unavailable: what the bar presses, so it never forces one already leaving for it (docs/architecture.md § Selecting several). */
function offers(key: string, action: 'stop' | 'close', view: View<'tabs'>): boolean {
  return view.tabs.some((tab) => tab.session.id === key && ((item) => !item.disabled && item.mark === action)(leaveAction(leaveTab(tab, view), action)));
}

const stoppable = (key: string, view: View<'tabs'> = store.get()): boolean => offers(key, 'stop', view);
const closable = (key: string, view: View<'tabs'>): boolean => offers(key, 'close', view);

/** Whether Archive can act on a session: not while a tab of it is starting, which has no claude yet to ask to leave (`archiveSessions`). */
const archivable = (key: string, view: View<'tabs'>): boolean => !view.tabs.some((tab) => tab.session.id === key && tab.starting);

/** What a toast calls the ticked sessions: the one by its title, or how many. */
function named(keys: readonly string[]): string {
  const [only] = keys;
  const session = only !== undefined && keys.length === 1 ? currentByKey.get(only) : undefined;
  return session ? `"${sessionLabel(session)}"` : `${keys.length} sessions`;
}

/**
 * Later from the bar: every ticked session marked in one write, and one toast whose Undo puts each back as it was, its old mark or none.
 * A session's menu raises no toast for its Later, since its row stays where it was (decided 2026-11-04): a batch's rows can leave what is on show, and the toast is then what says what happened.
 */
function setAside(keys: readonly string[], due: number | null): void {
  const before = new Map(keys.map((key) => [key, store.get().later.get(key)]));
  markLater(keys, due);
  showToast(`Set ${named(keys)} aside for later${due === null ? '' : `, until ${momentLabel(due)}`}`, false, {
    label: 'Undo',
    run: () => {
      clearLater(keys.filter((key) => before.get(key) === undefined));
      for (const [key, mark] of before) if (mark) markLater([key], mark.due, mark.at);
    },
  });
}

/** Run an act of the bar on the ticked rows on show, unless it is unavailable now. */
function onAct(name: string, run: (keys: string[], button: HTMLButtonElement) => void): void {
  const button = act(name);
  button.addEventListener('click', () => {
    if (unavailable(button)) return;
    run(ticked(), button);
  });
}

onAct('archive', (keys) => hostOf('sessions').archiveSessions(keys));
onAct('later', (keys, button) => openMenu(button, laterChoices(named(keys), (due) => setAside(keys, due))));
onAct('move', (keys, button) => openMenu(button, moveToGroupItems(sessionsOf(keys))));
onAct('stop', (keys) => {
  for (const key of keys) if (stoppable(key)) hostOf('sessions').pressLeave(key, 'stop', 'stop');
});
onAct('close', (keys) => hostOf('sessions').closeTabs(keys));

byId(bulkLine, 'bulk-done', HTMLButtonElement).addEventListener('click', endBulk);

// Esc ends bulk mode, but never a key meant for something else: one typed where text goes, a terminal's included, since claude reads Esc there, or one while a menu, a dialog or the filter's calendar is up, which close on it themselves.
// Those listen on the document too and take no default, so what is open is asked; this listener is registered first, so a dialog is still up when it is asked.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || store.get().bulk === null) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable], .xterm')) return;
  if (document.querySelector('.kebab-menu, .overlay:not([hidden]), #date-custom:not([hidden])')) return;
  endBulk();
});

/**
 * Bulk mode follows the store: drawn whenever it, or the tabs the bar's Stop and Close read, change.
 * The archived view has no acts for its sessions, so turning it on ends bulk mode, as Done would.
 */
export function bulkFollows(view: View<'bulk' | 'tabs' | 'filter'>): void {
  if (view.bulk && view.filter.filters.archived) {
    endBulk();
    return;
  }
  showBulk(view);
}
