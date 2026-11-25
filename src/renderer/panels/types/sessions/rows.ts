import type { SessionSummary } from '../../../../shared/types';
// Its rows are the card a list panel draws too.
import { listCard } from '../../../ui/card';
import { setMarkup } from '../../../ui/keyed';
import { entityKey, rowLine, sessionLabel, unstartableReason, worktreeMarkState } from '../../../rules/sessions';
import { clockOf } from '../../../status/clock';
import { kebabButton } from '../../../ui/menu';
import { redrawMoment, showMoment, type Moment } from '../../../ui/moments';
import { notLeftWords } from '../../../rules/claude';
import { notLeftMark, showNotLeft } from '../../../status/not-left';
import { inkClasses, PR_INKS, prMark, prRulesIn } from '../../../status/pr-status';
import { setAsideMark, showSetAside } from '../../../status/set-aside-mark';
import { showSuperseded, supersededMark } from '../../../status/superseded-mark';
import { scheduledMark, showScheduled } from '../../../status/scheduled-mark';
import { store, type View } from '../../../state/app';
import { tabOnShow, tabWith } from '../../../state/views';
import { ackOnClick, applyStatus, rowStateLines } from '../../../status/status-dot';
import type { RowLines, RowMark } from '../../../rules/sectioned-view';
import { noteMark, showNote } from '../../../status/note-mark';
import { PIN_ICON, PINNED_ICON, PR_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from '../../../ui/svg';
import { showToast } from '../../../ui/toast';
import { setTooltip } from '../../../ui/tooltip';
import { hostOf } from '../builtin';
import { confirmAndDelete, editNote, openPrsMenu, openSiblingsMenu, openWorktreesMenu, sessionMenuItems, togglePinFor } from './actions';
import { pressRowInBulk, tickBox } from './bulk';
import { activityMoment, finishedMoment, rowTooltip } from './describe';
import type { DrawnRows, RowTabMarks } from './drawn';
import '../../../ui/tone.css';
import '../../../status/pr-status.css';
import '../../../ui/badge.css';
import './rows.css';

/**
 * THE SESSION LIST'S ROWS: a session's card, built once per session with its marks and controls and kept across renders, and brought up to date for the session it shows on every render (list.ts).
 */

/**
 * Mark `drawn`'s rows whose session has a tab, open or cold, and the one on show: only those rows and the ones marked before, rather than every row drawn, since few sessions have a tab.
 * "Has a tab" and "is running" stopped being the same thing once tabs restore cold, so the row says which: an accent bar for a live session, a muted one for a tab waiting to be resumed.
 */
export function markTabs(drawn: DrawnRows, view: View<'tabs' | 'activeTab'>): void {
  const shown = tabOnShow(view);
  const withTab = new Set(view.tabs.flatMap((tab) => drawn.rows.find(tab.session.id) ?? []));
  const touched = new Set([...drawn.markedTabs, ...withTab]);
  drawn.markedTabs = withTab;
  for (const row of touched) {
    const id = row.dataset.sid ?? '';
    const tab = tabWith(id, view);
    row.classList.toggle('open', tab !== undefined);
    row.classList.toggle('cold', tab?.terminalId === null);
    row.classList.toggle('active-session', shown?.session.id === id);
  }
}

/** Whether `drawn`'s rows show the finished sessions: the sidebar's, while its finished view is on. */
const inFinishedView = (drawn: DrawnRows, view: View<'filter'> = store.get()): boolean => drawn.sidebar && view.filter.finished;

/** The row for a session this render of `drawn`'s list draws, built the first time and the same element after that. */
export function drawRow(drawn: DrawnRows, key: string): HTMLElement {
  return drawn.rows.draw(key, (each) => createSessionRow(drawn, each));
}

// Take it back out of the box.
// Finishing has no row icon — it is a kebab item (text) in the normal view; only reopening, the finished view's primary action, stays a button on the row.
// Redrawn from its 24-unit original at two-thirds scale, onto the 16-unit grid the helper draws on.
const REOPEN_ICON = strokeIcon(14, '<path d="M.67 2.67v4h4" /><path d="M2.34 10a6 6 0 1 0 1.42-6.24L.67 6.67" />');

interface RowEls {
  dot: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  worktreeCount: HTMLElement;
  clock: HTMLElement;
  setAside: HTMLElement;
  superseded: HTMLElement;
  notLeft: HTMLElement;
  siblingsBadge: HTMLElement;
  siblingCount: HTMLElement;
  prBadge: HTMLElement;
  prCount: HTMLElement;
  noteBadge: HTMLElement;
  noteSep: HTMLElement;
  meta: HTMLElement;
  metaText: HTMLElement;
  /** A line per state the session is in, drawn only where its section says `state`. */
  stateLines: HTMLElement;
  pin: HTMLButtonElement;
  reopenBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  kebab: HTMLButtonElement;
}
// Each row's child elements, cached so updateRow reads them directly instead of re-querying the DOM every render (same idea as the session summary cache, applied to rendering).
const rowEls = new WeakMap<HTMLElement, RowEls>();

/**
 * A mark on a row that counts what a session has and lists it on a click: an icon, a count, and a menu that `open` puts up against the mark.
 * Hidden until the row says otherwise; `className` names which mark it is.
 * `menu-badge` on it is what makes it a control, its pointer and its hover (rows.css), so a mark that has nothing to list for a while, as the worktree mark of a session that worked in one worktree, takes it off, and a press on it is then the row's.
 */
function menuBadge(className: string, icon: string, open: (anchor: HTMLElement) => void): { badge: HTMLElement; count: HTMLElement } {
  const badge = document.createElement('span');
  badge.className = `menu-badge ${className}`;
  badge.hidden = true;
  const iconEl = document.createElement('span');
  iconEl.className = 'badge-icon';
  iconEl.innerHTML = icon;
  const count = document.createElement('span');
  count.className = 'badge-text';
  badge.append(iconEl, count);
  badge.addEventListener('click', (event) => {
    if (!badge.classList.contains('menu-badge')) return;
    // The row's own click opens the session; a press on the mark is the mark's.
    event.stopPropagation();
    open(badge);
  });
  return { badge, count };
}

/** A row's buttons at its end, each acting on the session `drawn` lists under `key` when pressed: its pin, Reopen and Delete, which the finished view shows, and its menu. */
function rowButtons(drawn: DrawnRows, key: string): { pin: HTMLButtonElement; reopenBtn: HTMLButtonElement; deleteBtn: HTMLButtonElement; kebab: HTMLButtonElement } {
  const pin = document.createElement('button');
  pin.className = 'icon-btn pin';
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    // Disabling it is the pending cue: the icon button's disabled look dims it (base.css).
    // (There was a 'loading' class here with no CSS behind it, so it painted nothing.)
    pin.disabled = true;
    void togglePinFor(key).then(() => {
      // The row's redraw re-enables it; this is for an answer that changed nothing, which tells nobody.
      pin.disabled = false;
    });
  });

  // Reopen lives on the row because it is what the finished view is for; finishing a live session is a kebab item instead (shown/hidden in updateRow), so a normal row carries only pin + kebab.
  // It stays pressable when the session's folder is gone, and the open says why, as a press on a normal row does.
  const reopenBtn = document.createElement('button');
  reopenBtn.className = 'icon-btn reopen-btn';
  reopenBtn.hidden = true;
  reopenBtn.innerHTML = REOPEN_ICON;
  setTooltip(reopenBtn, 'Reopen: make it unfinished and open it');
  reopenBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    hostOf('sessions').openTab(key);
  });

  // Delete lives only in the finished view (shown/hidden in updateRow); trash-based + confirmed.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete-btn pair-end';
  setTooltip(deleteBtn, 'Delete session');
  deleteBtn.hidden = true;
  deleteBtn.innerHTML = strokeIcon(14, '<path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.8 4.5l.5 8h5.4l.5-8" />');
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void confirmAndDelete([key]);
  });

  // The session's menu, in both views: a finished session's holds the finished view's two actions among its items (`sessionMenuItems`).
  const kebab = kebabButton('session-kebab pair-end', 'Session options', () => {
    const session = drawn.current.get(key);
    return session ? sessionMenuItems(session, 'row') : null;
  });
  return { pin, reopenBtn, deleteBtn, kebab };
}

// Build a row once.
// Its handlers read the live session from its list's `current` by the entity key (the session id), so a reused row stays correct across re-renders.
function createSessionRow(drawn: DrawnRows, key: string): HTMLElement {
  const { card: item, content, title, meta } = listCard('session');
  item.dataset.key = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  ackOnClick(dot, () => drawn.current.get(key)?.id ?? null);
  // The worktree mark: the branch icon, and a count of the checkouts the session worked in, which opens a list of them, while it has one (set in updateRow).
  // No word — "worktree" cost a badge-width of room and the branch icon plus its tooltip already say it.
  // Being wordless, the pill carries its own aria-label (set in updateRow).
  const { badge, count: worktreeCount } = menuBadge('worktree-badge worktree-mark', WORKTREE_ICON, (anchor) => {
    const session = drawn.current.get(key);
    if (session) openWorktreesMenu(anchor, session);
  });
  // A family member's mark: the fork icon plus a count of its siblings, which opens a list of them to jump into.
  // Shown only when session.isSibling (set in updateRow).
  const { badge: siblingsBadge, count: siblingCount } = menuBadge('sibling-badge', SIBLING_ICON, (anchor) => {
    const session = drawn.current.get(key);
    if (session) openSiblingsMenu(anchor, session);
  });
  // The PRs the session's transcript links: the pull-request icon plus a count, which opens a list of them to open in the browser.
  // Shown only when it links one (set in updateRow).
  const { badge: prBadge, count: prCount } = menuBadge('pr-badge pr-ink', PR_ICON, (anchor) => {
    const session = drawn.current.get(key);
    if (session) openPrsMenu(anchor, session);
  });
  // The card's meta line holds the time and model, plus the note mark riding along at the end of that text.
  // The mark lives HERE rather than beside the title because a sibling box next to a text block has to have its alignment guessed; inside the text row it just centres.
  // The meta is short and single-line, so nothing can clip the mark off the way a two-line title clamp would.
  const metaText = document.createElement('span');
  metaText.className = 'meta-text';
  // The badges used to take a line of their own between title and meta.
  // They ride the meta's line now: the meta takes the remaining width (and still stacks by itself if it must), the marks keep their intrinsic size at the right.
  const noteBadge = noteMark(() => {
    const session = drawn.current.get(key);
    if (session) void editNote(session);
  });

  // A separator before the mark, matching the " · " already between time and model.
  // Hidden with the mark, so a row without a note doesn't end in a dangling dot.
  const noteSep = document.createElement('span');
  noteSep.className = 'meta-sep';
  noteSep.textContent = '·';
  noteSep.hidden = true;
  // A stop claude has not left, as its tab says it (not-left.ts), in place of the time and model while it does.
  const notLeft = notLeftMark('meta-not-left');
  meta.append(notLeft, metaText, noteSep, noteBadge);

  const subline = document.createElement('div');
  subline.className = 'session-subline';
  // A task claude has scheduled for the session, as its tab shows it (scheduled-mark.ts); shown in updateRow.
  const clock = scheduledMark('scheduled-badge', true);
  // Set aside, as its tab shows it (set-aside-mark.ts); shown in updateRow.
  const setAside = setAsideMark('set-aside-badge', true);
  // An older copy of its transcript that another copy replaced (superseded-mark.ts); shown in updateRow.
  const superseded = supersededMark('superseded-badge', true);
  // A press reads the newest copy in the session's history, and only that: the row's own press would start claude.
  // Not in the finished view, where a press on the row opens nothing either, so a stray press cannot open a finished session.
  superseded.addEventListener('click', (event) => {
    event.stopPropagation();
    if (inFinishedView(drawn)) return;
    const session = drawn.current.get(key);
    const newest = session?.supersededCopies.at(-1);
    if (session && newest) hostOf('sessions').openOlderCopy(session.id, newest.stamp);
  });
  subline.append(meta, badge, clock, setAside, siblingsBadge, prBadge, superseded);
  const stateLines = document.createElement('div');
  stateLines.className = 'session-state-lines';
  stateLines.hidden = true;
  content.append(subline, stateLines);

  const { pin, reopenBtn, deleteBtn, kebab } = rowButtons(drawn, key);

  // Its box in bulk mode, before the dot (bulk.ts); drawn only then, and a press anywhere on the row ticks it then.
  item.prepend(tickBox(), dot);
  item.append(pin, reopenBtn, deleteBtn, kebab);
  followSight(item);
  rowEls.set(item, { dot, title, badge, worktreeCount, clock, setAside: setAside, superseded, notLeft, siblingsBadge, siblingCount, prBadge, prCount, noteBadge, noteSep, meta, metaText, stateLines, pin, reopenBtn, deleteBtn, kebab });
  item.addEventListener('click', (event) => {
    // In the sidebar's bulk mode a press ticks the row rather than opening it; the dot, the marks, the pin and the kebab keep their own presses, which stop here.
    if (drawn.sidebar && store.get().bulk) {
      pressRowInBulk(key, event.shiftKey);
      return;
    }
    // A press on a finished row does nothing, so a stray press cannot reopen it: its Reopen button and its menu's Reopen do.
    if (inFinishedView(drawn)) return;
    const session = drawn.current.get(key);
    if (!session) return;
    // A session whose folder is gone cannot run anywhere.
    // The row says so in its tooltip, and this answers the click for anyone who tries it anyway rather than opening a tab that could only fail.
    const reason = unstartableReason(session);
    if (reason) {
      showToast(reason);
      return;
    }
    hostOf('sessions').openTab(session.id);
  });
  return item;
}

const listedById = new WeakMap<SessionSummary[], Map<string, SessionSummary>>();

/**
 * `session` as the newest listing has it: the store keeps a listing whose only change is a last activity, and tells nobody (`sameRows`, state/app.ts).
 * A session with no transcript yet is not in the listing, and stays as it was drawn.
 */
function newest(session: SessionSummary): SessionSummary {
  const { sessions } = store.get();
  let byId = listedById.get(sessions);
  if (!byId) {
    byId = new Map(sessions.map((s) => [s.id, s]));
    listedById.set(sessions, byId);
  }
  return byId.get(session.id) ?? session;
}

/** What a row draws from the store besides the session it shows and whether the finished view is on, which it reads from the filter. */
export const ROW_SLICES = ['statuses', 'backgroundTasks', 'scheduledTasks', 'acked', 'needsYou', 'setAside', 'switchedModel', 'pinned', 'finished', 'notes', 'tabs', 'prStatus', 'reviewing', 'settings', 'needsYouTypes', 'prNames'] as const;
export type RowView = View<(typeof ROW_SLICES)[number] | 'filter'>;

/** What a row was last brought up to date for. */
interface DrawnFor {
  /** Its session's line (`rowLine`) and its last activity, which the line leaves out and the row's time and tooltip say. */
  session: string;
  generation: number;
  finishedView: boolean;
}
const drawnFor = new WeakMap<HTMLElement, DrawnFor>();

/**
 * Rows the browser has said are out of sight, which it then skips drawing (rows.css), and for each the update a draw owed it meanwhile: made in full, from the store as it then is, once the browser says the row is in sight again.
 * A row the browser has said nothing of yet counts as in sight, so a row drawn for the first time is brought up to date at once.
 */
const outOfSight = new WeakSet<HTMLElement>();
const owed = new WeakMap<HTMLElement, () => void>();

/** Follow `row` coming into and going out of sight, paying what it is owed as it comes in, or at least its time, which the minute's clock left as it was. */
function followSight(row: HTMLElement): void {
  row.addEventListener('contentvisibilityautostatechange', (event) => {
    if ((event as ContentVisibilityAutoStateChangeEvent).skipped) {
      outOfSight.add(row);
      return;
    }
    outOfSight.delete(row);
    const pay = owed.get(row);
    owed.delete(row);
    if (pay) pay();
    else redrawMoment(rowEls.get(row)!.metaText);
  });
}

/** Show what a row has from the tab running its session: its clock (`clockOf`), and the words for a stop claude has not left (not-left.ts), in place of its time and model while they show. */
export function showTabMarks(marks: RowTabMarks, id: string, view: View<'scheduledTasks' | 'tabs'>): void {
  const tab = tabWith(id, view);
  showScheduled(marks.clock, clockOf(view.scheduledTasks.get(id), tab));
  const notLeft = showNotLeft(marks.notLeft, tab);
  if (marks.metaText.hidden === notLeft) return;
  marks.metaText.hidden = notLeft;
  // The row's tooltip says the line on show, which these words replace (`rowTooltip`).
  redrawMoment(marks.metaText);
}

/**
 * What a row drawn flat says under its title (`RowLines`), ahead of the rest of its line where it sits, where no heading above it says so, and which marks it leaves out.
 * Where it sits is worked out again on the minute clock like the time it leads, of the session as the newest listing has it.
 */
export interface FlatLine {
  lead: (shown: SessionSummary) => string | null;
  lines: RowLines;
  /** The marks the row leaves out. */
  hides: readonly RowMark[];
}

/**
 * Show a row's PR mark: the PRs its session links, linked rather than opened, since a record says the PR is linked to the session, not who opened it.
 * Coloured by its PRs' roll-up tone, and its tooltip says what set it; the classes are toggled rather than set, since an open menu has marked the badge too.
 */
function showPrMark(els: RowEls, session: SessionSummary, view: RowView): void {
  const prCount = session.prs.length;
  els.prBadge.hidden = prCount === 0;
  if (prCount === 0) return;
  const mark = prMark(session.prs, view.prStatus, prRulesIn(view));
  // Every ink and look class off first, then the mark's on: a look's class names the type that inked it, which changes with the PRs.
  els.prBadge.classList.remove(...PR_INKS.map((ink) => `tone-${ink}`), ...[...els.prBadge.classList].filter((name) => name.startsWith('look-')));
  els.prBadge.classList.add(...inkClasses(mark));
  els.prCount.textContent = String(prCount);
  setTooltip(els.prBadge, `${prCount === 1 ? '1 PR' : `${prCount} PRs`} linked to this session${mark.says ? ` — ${mark.says}` : ''} — click to list them`);
}

/**
 * Draw a row's states where its section says `state`, and take them away where it says anything else.
 * The first goes on the line under the title, beside the marks, where a row's time goes elsewhere, so it is handed back for that line; the rest go under it, a line each.
 */
function showStateLines(el: HTMLElement, id: string, view: RowView, lines: RowLines): { text: string; read: boolean } | null {
  const [first = null, ...rest] = lines === 'state' ? rowStateLines(id, view) : [];
  el.hidden = rest.length === 0;
  el.replaceChildren(
    ...rest.map(({ text, read }) => {
      const line = document.createElement('span');
      line.className = read ? 'session-state-line read' : 'session-state-line';
      line.textContent = text;
      return line;
    }),
  );
  return first;
}

/**
 * Bring `row`, one of `drawn`'s, up to date for `session`; `flat` for a row drawn flat (flat.ts), which leads its line with where it sits.
 * A row on the page already drawn for the same session at the same count of changes (`DrawnRows.inputs`) is left as it is, its dot and tab marks only counted in again for this draw; one drawn flat is always brought up to date, since where it sits is not in the count.
 * One out of sight is owed the update instead, until it comes into sight (`followSight`).
 */
export function updateRow(drawn: DrawnRows, row: HTMLElement, session: SessionSummary, view: RowView, flat?: FlatLine): void {
  const els = rowEls.get(row)!;
  // The review sets the filter aside, the finished view with it.
  const finishedView = inFinishedView(drawn, view) && !view.reviewing;
  const now: DrawnFor = { session: `${rowLine(session)}\0${session.lastActivity}`, generation: drawn.inputs.generation, finishedView };
  const was = drawnFor.get(row);
  if (!flat && row.isConnected && was?.session === now.session && was.generation === now.generation && was.finishedView === now.finishedView) {
    drawn.dots.set(session.id, els.dot);
    drawn.tabMarks.set(session.id, els);
    return;
  }
  if (!flat && outOfSight.has(row)) {
    const key = row.dataset.key ?? session.id;
    owed.set(row, () => {
      const latest = drawn.current.get(key);
      drawnFor.delete(row);
      if (latest) updateRow(drawn, row, latest, store.get());
    });
    drawn.dots.set(session.id, els.dot);
    drawn.tabMarks.set(session.id, els);
    return;
  }
  // Brought up to date now, so what an earlier draw left it owing is paid, and must not come back over this draw once the row comes into sight.
  owed.delete(row);
  drawnFor.set(row, now);
  row.dataset.sid = session.id;

  applyStatus(els.dot, session.id, view);
  drawn.dots.set(session.id, els.dot);

  els.title.textContent = sessionLabel(session);
  // A session that cannot run says why on the row's own tooltip (`rowTooltip`), rather than only when you try it: the tooltip is the one place with room for the folder's path.
  row.classList.toggle('unstartable', unstartableReason(session) !== null);

  const worktree = worktreeMarkState(session);
  els.badge.hidden = worktree === null;
  els.badge.classList.toggle('muted', worktree?.muted === true);
  // A control only while it has a list (`menuBadge`).
  els.badge.classList.toggle('menu-badge', (worktree?.count ?? 0) > 0);
  els.worktreeCount.hidden = (worktree?.count ?? 0) === 0;
  els.worktreeCount.textContent = worktree?.count ? String(worktree.count) : '';
  if (worktree) {
    const tooltip = worktree.count > 0 ? `${worktree.tooltip} — click to list them` : worktree.tooltip;
    setTooltip(els.badge, tooltip);
    els.badge.setAttribute('aria-label', tooltip);
  }

  showTabMarks(els, session.id, view);
  drawn.tabMarks.set(session.id, els);
  showSetAside(els.setAside, view.setAside.get(entityKey(session)));
  showSuperseded(els.superseded, session.supersededCopies, !inFinishedView(drawn, view));

  els.noteSep.hidden = !showNote(els.noteBadge, view.notes.get(entityKey(session)));

  els.siblingsBadge.hidden = !session.isSibling;
  if (session.isSibling) {
    const count = session.siblingIds.length;
    els.siblingCount.textContent = String(count);
    const label = count === 1 ? '1 sibling' : `${count} siblings`;
    setTooltip(els.siblingsBadge, `${label} in this session's family — click to list them`);
  }

  showPrMark(els, session, view);

  const firstState = showStateLines(els.stateLines, session.id, view, flat?.lines ?? 'time');
  els.metaText.classList.toggle('read', firstState?.read === true);
  // When it was finished in the finished view, where every session is; when it was active everywhere else.
  // On the clock, of the session as the newest listing has it, since its last activity can move with nothing drawn again (`AFFECTS_ROW`, rules/sessions.ts), and so is the row's tooltip, which says everything the row shows (`rowTooltip`) wherever on the row you hover; a button or mark with a tooltip of its own keeps it, the nearest tooltip being the one shown.
  // Where its section lists its states or keeps it compact, the line under its title says where it sits and its first state, and the time and model only its tooltip.
  const timeShown = (flat?.lines ?? 'time') === 'time';
  const moment = (shown: SessionSummary, as: RowView): Moment => {
    const own = (finishedView ? finishedMoment(shown, as) : null) ?? activityMoment(shown, as);
    const lead = flat?.lead(shown) ?? null;
    const full = lead ? `${lead} · ${own.text}` : own.text;
    const tab = tabWith(shown.id, as);
    const text = timeShown ? full : [lead, firstState?.text].filter((part) => part).join(' · ');
    return { ...own, text, tooltip: rowTooltip(shown, as, (tab && notLeftWords(tab)) ?? full, own) };
  };
  const shownNow = moment(session, view);
  // A separator before the note mark only after words, so a line of marks alone does not start with one.
  els.noteSep.hidden ||= shownNow.text === '';
  showMoment(els.metaText, shownNow, () => moment(newest(session), store.get()), row, () => outOfSight.has(row));

  // The finished view is a management view: no pinning, and delete replaces it there.
  const isPinned = view.pinned.has(entityKey(session));
  setMarkup(els.pin, isPinned ? PINNED_ICON : PIN_ICON);
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.hidden = finishedView;

  // Reopen and delete are the finished view's two buttons, shortcuts to the items its kebab holds, and appear nowhere else.
  els.reopenBtn.hidden = !finishedView;
  els.deleteBtn.hidden = !finishedView;
  hideMarks(els, flat?.hides ?? []);
}

/** Each mark's element on a row, the note's with the separator before it. */
const MARK_ELS: Record<RowMark, (els: RowEls) => HTMLElement[]> = {
  pin: (els) => [els.pin],
  pr: (els) => [els.prBadge],
  note: (els) => [els.noteBadge, els.noteSep],
  'set-aside': (els) => [els.setAside],
  worktree: (els) => [els.badge],
  siblings: (els) => [els.siblingsBadge],
  clock: (els) => [els.clock],
  superseded: (els) => [els.superseded],
};

/** Take off a row the marks its section leaves out, after the row has drawn each as its session says. */
function hideMarks(els: RowEls, hides: readonly RowMark[]): void {
  for (const mark of hides) for (const el of MARK_ELS[mark](els)) el.hidden = true;
}
