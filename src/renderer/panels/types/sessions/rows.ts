import type { SessionSummary } from '../../../../shared/types';
// Its rows are the card a list panel draws too.
import { listCard } from '../../../ui/card';
import { setMarkup } from '../../../ui/keyed';
import { entityKey, sessionLabel, unstartableReason, worktreeMarkState } from '../../../rules/sessions';
import { clockOf } from '../../../status/clock';
import { kebabButton } from '../../../ui/menu';
import { showMoment, type Moment } from '../../../ui/moments';
import { notLeftMark, showNotLeft } from '../../../status/not-left';
import { inkClasses, PR_INKS, prMark, prRulesIn } from '../../../status/pr-status';
import { setAsideMark, showSetAside } from '../../../status/set-aside-mark';
import { scheduledMark, showScheduled } from '../../../status/scheduled-mark';
import { store, type View } from '../../../state/app';
import { tabWith } from '../../../state/views';
import { ackOnClick, applyStatus } from '../../../status/status-dot';
import { noteMark, showNote } from '../../../status/note-mark';
import { PIN_ICON, PINNED_ICON, PR_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from '../../../ui/svg';
import { showToast } from '../../../ui/toast';
import { setTooltip } from '../../../ui/tooltip';
import { hostOf } from '../builtin';
import { confirmAndDelete, editNote, openPrsMenu, openSiblingsMenu, openWorktreesMenu, sessionMenuItems, togglePinFor, unfinishFor } from './actions';
import { pressRowInBulk, tickBox } from './bulk';
import { activityMoment, finishedMoment } from './describe';
import { currentByKey, rowTabMarks, sessionRows, statusDots, type RowTabMarks } from './drawn';
import '../../../ui/tone.css';
import '../../../status/pr-status.css';
import '../../../ui/badge.css';
import './rows.css';

/**
 * THE SESSION LIST'S ROWS: a session's card, built once per session with its marks and controls and kept across renders, and brought up to date for the session it shows on every render (list.ts).
 */

/** The row for a session this render draws, built the first time and the same element after that. */
export function drawRow(key: string): HTMLElement {
  return sessionRows.draw(key, createSessionRow);
}

// Take it back out of the box.
// Finishing has no row icon — it is a kebab item (text) in the normal view; only making unfinished, the finished view's primary action, stays a button on the row.
// Redrawn from its 24-unit original at two-thirds scale, onto the 16-unit grid the helper draws on.
const UNFINISH_ICON = strokeIcon(14, '<path d="M.67 2.67v4h4" /><path d="M2.34 10a6 6 0 1 0 1.42-6.24L.67 6.67" />');

interface RowEls {
  dot: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  worktreeCount: HTMLElement;
  clock: HTMLElement;
  setAside: HTMLElement;
  notLeft: HTMLElement;
  siblingsBadge: HTMLElement;
  siblingCount: HTMLElement;
  prBadge: HTMLElement;
  prCount: HTMLElement;
  noteBadge: HTMLElement;
  noteSep: HTMLElement;
  meta: HTMLElement;
  metaText: HTMLElement;
  pin: HTMLButtonElement;
  unfinishBtn: HTMLButtonElement;
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

/** A row's buttons at its end, each acting on the session listed under `key` when pressed: its pin, Unfinished and Delete, which the finished view shows, and its menu. */
function rowButtons(key: string): { pin: HTMLButtonElement; unfinishBtn: HTMLButtonElement; deleteBtn: HTMLButtonElement; kebab: HTMLButtonElement } {
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

  // Unfinished lives on the row because it is what the finished view is for; finishing a live session is a kebab item instead (shown/hidden in updateRow), so a normal row carries only pin + kebab.
  const unfinishBtn = document.createElement('button');
  unfinishBtn.className = 'icon-btn unfinish-btn';
  unfinishBtn.hidden = true;
  unfinishBtn.innerHTML = UNFINISH_ICON;
  setTooltip(unfinishBtn, 'Unfinished');
  unfinishBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void unfinishFor(key);
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
    const session = currentByKey.get(key);
    return session ? sessionMenuItems(session, 'row') : null;
  });
  return { pin, unfinishBtn, deleteBtn, kebab };
}

// Build a row once.
// Its click/pin handlers read the live session from `currentByKey` by the entity key (the session id), so a reused row stays correct across re-renders.
function createSessionRow(key: string): HTMLElement {
  const { card: item, content, title, meta } = listCard('session');
  item.dataset.key = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  ackOnClick(dot, () => currentByKey.get(key)?.id ?? null);
  // The worktree mark: the branch icon, and a count of the checkouts the session worked in, which opens a list of them, while it has one (set in updateRow).
  // No word — "worktree" cost a badge-width of room and the branch icon plus its tooltip already say it.
  // Being wordless, the pill carries its own aria-label (set in updateRow).
  const { badge, count: worktreeCount } = menuBadge('worktree-badge worktree-mark', WORKTREE_ICON, (anchor) => {
    const session = currentByKey.get(key);
    if (session) openWorktreesMenu(anchor, session);
  });
  // A family member's mark: the fork icon plus a count of its siblings, which opens a list of them to jump into.
  // Shown only when session.isSibling (set in updateRow).
  const { badge: siblingsBadge, count: siblingCount } = menuBadge('sibling-badge', SIBLING_ICON, (anchor) => {
    const session = currentByKey.get(key);
    if (session) openSiblingsMenu(anchor, session);
  });
  // The PRs the session's transcript links: the pull-request icon plus a count, which opens a list of them to open in the browser.
  // Shown only when it links one (set in updateRow).
  const { badge: prBadge, count: prCount } = menuBadge('pr-badge pr-ink', PR_ICON, (anchor) => {
    const session = currentByKey.get(key);
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
    const session = currentByKey.get(key);
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
  subline.append(meta, badge, clock, setAside, siblingsBadge, prBadge);
  content.append(subline);

  const { pin, unfinishBtn, deleteBtn, kebab } = rowButtons(key);

  // Its box in bulk mode, before the dot (bulk.ts); drawn only then, and a press anywhere on the row ticks it then.
  item.prepend(tickBox(), dot);
  item.append(pin, unfinishBtn, deleteBtn, kebab);
  rowEls.set(item, { dot, title, badge, worktreeCount, clock, setAside: setAside, notLeft, siblingsBadge, siblingCount, prBadge, prCount, noteBadge, noteSep, meta, metaText, pin, unfinishBtn, deleteBtn, kebab });
  item.addEventListener('click', (event) => {
    // In bulk mode a press ticks the row rather than opening it; the dot, the marks, the pin and the kebab keep their own presses, which stop here.
    if (store.get().bulk) {
      pressRowInBulk(key, event.shiftKey);
      return;
    }
    // Finished sessions are inert: manage them (make unfinished/delete), don't resume them.
    if (store.get().filter.filters.finished) return;
    const session = currentByKey.get(key);
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

// Refresh a reused row's content for the tip it now shows.
/** What a row draws from the store besides the session it shows. */
export type RowView = View<'statuses' | 'backgroundTasks' | 'scheduledTasks' | 'acked' | 'needsYou' | 'setAside' | 'switchedModel' | 'pinned' | 'finished' | 'notes' | 'filter' | 'tabs' | 'prStatus' | 'reviewing' | 'settings' | 'needsYouTypes' | 'prNames'>;

/** Show what a row has from the tab running its session: its clock (`clockOf`), and the words for a stop claude has not left (not-left.ts), in place of its time and model while they show. */
export function showTabMarks(marks: RowTabMarks, id: string, view: View<'scheduledTasks' | 'tabs'>): void {
  const tab = tabWith(id, view);
  showScheduled(marks.clock, clockOf(view.scheduledTasks.get(id), tab));
  marks.metaText.hidden = showNotLeft(marks.notLeft, tab);
}

/**
 * What a row drawn flat says ahead of the rest of its line, and in place of what.
 * `lead`: where it sits, where no heading above it says so.
 * `why`: for a row of the review (docs/architecture/session-list.md § The review), the line saying why it is there, in place of what the row says otherwise; null for a row that says it: its time and model, or in the finished view when it was finished.
 * Both worked out again on the minute clock like the time they lead or replace, of the session as the newest listing has it.
 */
export interface FlatLine {
  lead: (shown: SessionSummary) => string | null;
  why: ((shown: SessionSummary) => Moment) | null;
}

/** Bring `row` up to date for `session`; `flat` for a row drawn flat (list.ts), which leads its line with where it sits. */
export function updateRow(row: HTMLElement, session: SessionSummary, view: RowView, flat?: FlatLine): void {
  row.dataset.sid = session.id;
  const els = rowEls.get(row)!;
  // The review sets the filter aside, the finished view with it.
  const finishedView = view.filter.filters.finished && !view.reviewing;

  applyStatus(els.dot, session.id, view);
  statusDots.set(session.id, els.dot);

  els.title.textContent = sessionLabel(session);
  // A session that cannot run says why on the row itself, rather than only when you try it: the tooltip is the one place with room for the folder's path.
  const unstartable = unstartableReason(session);
  row.classList.toggle('unstartable', unstartable !== null);
  setTooltip(els.title, unstartable ?? sessionLabel(session));

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
  rowTabMarks.set(session.id, els);
  showSetAside(els.setAside, view.setAside.get(entityKey(session)));

  els.noteSep.hidden = !showNote(els.noteBadge, view.notes.get(entityKey(session)));

  els.siblingsBadge.hidden = !session.isSibling;
  if (session.isSibling) {
    const count = session.siblingIds.length;
    els.siblingCount.textContent = String(count);
    const label = count === 1 ? '1 sibling' : `${count} siblings`;
    setTooltip(els.siblingsBadge, `${label} in this session's family — click to list them`);
  }

  // Linked, not opened: a record says the PR is linked to the session, not who opened it.
  // Coloured by its PRs' roll-up tone, and its tooltip says what set it; the classes are toggled rather than set, since an open menu has marked the badge too.
  const prCount = session.prs.length;
  els.prBadge.hidden = prCount === 0;
  if (prCount > 0) {
    const mark = prMark(session.prs, view.prStatus, prRulesIn(view));
    // Every ink and look class off first, then the mark's on: a look's class names the type that inked it, which changes with the PRs.
    els.prBadge.classList.remove(...PR_INKS.map((ink) => `tone-${ink}`), ...[...els.prBadge.classList].filter((name) => name.startsWith('look-')));
    els.prBadge.classList.add(...inkClasses(mark));
    els.prCount.textContent = String(prCount);
    setTooltip(els.prBadge, `${prCount === 1 ? '1 PR' : `${prCount} PRs`} linked to this session${mark.says ? ` — ${mark.says}` : ''} — click to list them`);
  }

  // When it was finished in the finished view, where every session is; when it was active everywhere else.
  // On the clock, of the session as the newest listing has it, since its last activity can move with nothing drawn again (`AFFECTS_ROW`, rules/sessions.ts).
  const moment = (shown: SessionSummary, as: RowView): Moment => {
    const own = flat?.why?.(shown) ?? (finishedView ? finishedMoment(shown, as) : null) ?? activityMoment(shown, as);
    const lead = flat?.lead(shown) ?? null;
    return lead ? { ...own, text: `${lead} · ${own.text}` } : own;
  };
  showMoment(els.metaText, moment(session, view), () => moment(newest(session), store.get()));

  // The finished view is a management view: no pinning, and delete replaces it there.
  const isPinned = view.pinned.has(entityKey(session));
  setMarkup(els.pin, isPinned ? PINNED_ICON : PIN_ICON);
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.hidden = finishedView;

  // Unfinished and delete are the finished view's two buttons, shortcuts to the items its kebab holds, and appear nowhere else.
  els.unfinishBtn.hidden = !finishedView;
  els.deleteBtn.hidden = !finishedView;
}
