import type { SessionSummary } from '../../../../shared/types';
// Its rows are the card a list panel draws too.
import { listCard } from '../../../card';
import { setMarkup } from '../../../keyed';
import { entityKey, sessionLabel, unstartableReason, worktreeMarkState } from '../../../logic';
import { kebabButton } from '../../../menu';
import { prMark } from '../../../prstatus';
import { store, type View } from '../../../state/app';
import { ackOnClick, applyStatus } from '../../../statusdot';
import { NOTE_ICON, PIN_ICON, PINNED_ICON, PR_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from '../../../svg';
import { showToast } from '../../../toast';
import { TONES } from '../../../tone';
import { setTooltip } from '../../../tooltip';
import { hostOf } from '../builtin';
import { confirmAndDelete, editNote, openPrsMenu, openSiblingsMenu, sessionMenuItems, toggleArchiveFor, togglePinFor } from './actions';
import { activityLine, archivedLine, sessionTitle } from './describe';
import { currentByKey, sessionRows, statusDots } from './drawn';
import '../../../tone.css';
import '../../../prstatus.css';
import './rows.css';

/**
 * THE SESSION LIST'S ROWS: a session's card, built once per session with its marks and controls and kept across renders, and brought up to date for the session it shows on every render (list.ts).
 */

/** The row for a session this render draws, built the first time and the same element after that. */
export function drawRow(key: string): HTMLElement {
  return sessionRows.draw(key, createSessionRow);
}

// Take it back out of the box.
// Archiving has no row icon — it is a kebab item (text) in the normal view; only unarchiving, the archived view's primary action, stays a button on the row.
// Redrawn from its 24-unit original at two-thirds scale, onto the 16-unit grid the helper draws on.
const UNARCHIVE_ICON = strokeIcon(14, '<path d="M.67 2.67v4h4" /><path d="M2.34 10a6 6 0 1 0 1.42-6.24L.67 6.67" />');

interface RowEls {
  dot: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  siblingsBadge: HTMLElement;
  siblingCount: HTMLElement;
  prBadge: HTMLElement;
  prCount: HTMLElement;
  noteBadge: HTMLElement;
  noteSep: HTMLElement;
  meta: HTMLElement;
  metaText: HTMLElement;
  pin: HTMLButtonElement;
  unarchiveBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  kebab: HTMLButtonElement;
}
// Each row's child elements, cached so updateRow reads them directly instead of re-querying the DOM every render (same idea as the session summary cache, applied to rendering).
const rowEls = new WeakMap<HTMLElement, RowEls>();

/**
 * A mark on a row that counts what a session has and lists it on a click: an icon, a count, and a menu that `open` puts up against the mark.
 * Hidden until the row says otherwise; `className` names which mark it is.
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
    // The row's own click opens the session; a press on the mark is the mark's.
    event.stopPropagation();
    open(badge);
  });
  return { badge, count };
}

// Build a row once.
// Its click/pin handlers read the live session from `currentByKey` by the entity key (the session id), so a reused row stays correct across re-renders.
function createSessionRow(key: string): HTMLElement {
  const { card: item, content, title, meta } = listCard('session');
  item.dataset.key = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  ackOnClick(dot, () => currentByKey.get(key)?.id ?? null);
  const badge = document.createElement('span');
  badge.className = 'worktree-badge worktree-mark';
  badge.hidden = true;
  // Icon only — the word "worktree" cost a badge-width of room and the branch icon plus its tooltip already say it.
  // Being wordless, the pill carries its own aria-label (set in updateRow).
  const wtIcon = document.createElement('span');
  wtIcon.className = 'badge-icon';
  wtIcon.innerHTML = WORKTREE_ICON;
  badge.append(wtIcon);
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
  // A note's mark, clickable straight into the editor — if you can see there's a note, the natural move is to read it, and the tooltip only previews the first line.
  const noteBadge = document.createElement('span');
  noteBadge.className = 'note-badge';
  noteBadge.hidden = true;
  noteBadge.innerHTML = NOTE_ICON;
  noteBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) void editNote(session);
  });

  // A separator before the mark, matching the " · " already between time and model.
  // Hidden with the mark, so a row without a note doesn't end in a dangling dot.
  const noteSep = document.createElement('span');
  noteSep.className = 'meta-sep';
  noteSep.textContent = '·';
  noteSep.hidden = true;
  meta.append(metaText, noteSep, noteBadge);

  const subline = document.createElement('div');
  subline.className = 'session-subline';
  subline.append(meta, badge, siblingsBadge, prBadge);
  content.append(subline);

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

  // Unarchive lives on the row because it is what the archived view is for; archiving a live session is a kebab item instead (shown/hidden in updateRow), so a normal row carries only pin + kebab.
  const unarchiveBtn = document.createElement('button');
  unarchiveBtn.className = 'icon-btn unarchive-btn';
  unarchiveBtn.hidden = true;
  unarchiveBtn.innerHTML = UNARCHIVE_ICON;
  setTooltip(unarchiveBtn, 'Unarchive');
  unarchiveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleArchiveFor(key);
  });

  // Delete lives only in the archived view (shown/hidden in updateRow); trash-based + confirmed.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete-btn pair-end';
  setTooltip(deleteBtn, 'Delete session');
  deleteBtn.hidden = true;
  deleteBtn.innerHTML = strokeIcon(14, '<path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.8 4.5l.5 8h5.4l.5-8" />');
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void confirmAndDelete(key);
  });

  // The session's menu, in both views: an archived session's holds the archived view's two actions among its items (`sessionMenuItems`).
  const kebab = kebabButton('session-kebab pair-end', 'Session options', () => {
    const session = currentByKey.get(key);
    return session ? sessionMenuItems(session, 'row') : null;
  });

  item.prepend(dot);
  item.append(pin, unarchiveBtn, deleteBtn, kebab);
  rowEls.set(item, { dot, title, badge, siblingsBadge, siblingCount, prBadge, prCount, noteBadge, noteSep, meta, metaText, pin, unarchiveBtn, deleteBtn, kebab });
  item.addEventListener('click', () => {
    // Archived sessions are inert: manage them (unarchive/delete), don't resume them.
    if (store.get().filter.filters.archived) return;
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

// Refresh a reused row's content for the tip it now shows.
/** What a row draws from the store besides the session it shows. */
export type RowView = View<'statuses' | 'backgroundTasks' | 'acked' |'switchedModel' | 'pinned' | 'archived' | 'notes' | 'filter' | 'tabs' | 'prStatus'>;

export function updateRow(row: HTMLElement, session: SessionSummary, view: RowView): void {
  row.dataset.sid = session.id;
  const els = rowEls.get(row)!;
  const archivedView = view.filter.filters.archived;

  applyStatus(els.dot, session.id, view);
  statusDots.set(session.id, els.dot);

  els.title.textContent = sessionTitle(session);
  // A session that cannot run says why on the row itself, rather than only when you try it: the tooltip is the one place with room for the folder's path.
  const unstartable = unstartableReason(session);
  row.classList.toggle('unstartable', unstartable !== null);
  setTooltip(els.title, unstartable ?? (sessionLabel(session, '') || null));

  const worktree = worktreeMarkState(session);
  els.badge.hidden = worktree === null;
  els.badge.classList.toggle('left', worktree?.left === true);
  if (worktree) {
    setTooltip(els.badge, worktree.tooltip);
    els.badge.setAttribute('aria-label', worktree.tooltip);
  }

  const note = view.notes.get(entityKey(session));
  els.noteBadge.hidden = !note;
  els.noteSep.hidden = !note;
  // Tooltips are one line, so preview the start rather than dumping a long note into it.
  // The tooltip wraps and keeps line breaks now, so it can show a real chunk of the note.
  if (note) setTooltip(els.noteBadge, note.length > 400 ? `${note.slice(0, 400)}…` : note);

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
    const mark = prMark(session.prs, view.prStatus);
    for (const tone of TONES) els.prBadge.classList.toggle(`tone-${tone}`, tone === mark.tone);
    els.prCount.textContent = String(prCount);
    setTooltip(els.prBadge, `${prCount === 1 ? '1 PR' : `${prCount} PRs`} linked to this session${mark.says ? ` — ${mark.says}` : ''} — click to list them`);
  }

  // When it was archived in the archived view, where every session is; when it was active everywhere else.
  els.metaText.textContent = (archivedView && archivedLine(session, view)) || activityLine(session, view);

  // The archived view is a management view: no pinning, and delete replaces it there.
  const isPinned = view.pinned.has(entityKey(session));
  setMarkup(els.pin, isPinned ? PINNED_ICON : PIN_ICON);
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.hidden = archivedView;

  // Unarchive and delete are the archived view's two buttons, shortcuts to the items its kebab holds, and appear nowhere else.
  els.unarchiveBtn.hidden = !archivedView;
  els.deleteBtn.hidden = !archivedView;
}
