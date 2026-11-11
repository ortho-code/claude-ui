import { prReference } from '../../shared/sessions/prs';
import type { SessionSummary } from '../../shared/types';
import { entityKey, unstartableReason, worktreeMarkState } from './sessions';

// The [from, to] window for a date preset, rolling from `now`.
// 'any' and 'custom' have no preset bounds ('custom' is read from the date inputs by the caller).
export function datePresetRange(preset: string, now: number): { from: number | null; to: number | null } {
  const day = 86_400_000;
  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: null };
  }
  if (preset === '7d') return { from: now - 7 * day, to: null };
  if (preset === '30d') return { from: now - 30 * day, to: null };
  return { from: null, to: null };
}

export interface FilterCriteria {
  /** Case-insensitive text; empty means no text filter. */
  text: string;
  pinnedOnly: boolean;
  /** Show only sessions with a tab — running or cold. */
  openOnly: boolean;
  /**
   * Show only LIVE sessions — a claude process behind them.
   * Narrower than openOnly, which counts a cold tab too.
   */
  liveOnly: boolean;
  /** Show only sessions set aside, with a tab or without. */
  setAsideOnly: boolean;
  worktreeOnly: boolean;
  /** Show only sessions that cannot run because their folder is gone — the set worth finding to clean up, or to put a folder back for. */
  goneOnly: boolean;
  /** Show only members of a multi-session family (siblings). */
  siblingOnly: boolean;
  /** Show only sessions whose transcript links a PR. */
  prsOnly: boolean;
  finishedOnly: boolean;
  /**
   * Show only sessions carrying a note.
   * Reads `notes`, where an entry exists only when there IS one (a blank note deletes it).
   */
  notedOnly: boolean;
  dateFrom: number | null;
  dateTo: number | null;
  pinned: ReadonlySet<string>;
  /** Keys of the sessions with a tab; only consulted when openOnly is set. */
  open?: ReadonlySet<string>;
  /** Keys of the live sessions; only consulted when liveOnly is set. */
  live?: ReadonlySet<string>;
  /** Keys of the sessions set aside; only consulted when setAsideOnly is set. */
  setAside?: { has(key: string): boolean };
  /** Set or Map keyed by conversationId; only membership is used. */
  finished: { has(key: string): boolean };
  pendingDeletes: ReadonlySet<string>;
  /** Session id -> note, so typed text matches a note as well as a title. */
  notes?: ReadonlyMap<string, string>;
  /** Session key -> its group's name, so typing a group name surfaces everything in it. */
  groupNames?: ReadonlyMap<string, string>;
}

/**
 * Whether a session is in the set a view holds before any filter: the finished view holds the finished sessions, the normal view the rest, and a session on its way to the trash is in neither.
 * One rule for the list, the switcher's counts and the filter count's total, so the total is always the set the matches were taken from.
 */
export function inView(key: string, finishedView: boolean, finished: { has(key: string): boolean }, pendingDeletes: ReadonlySet<string>): boolean {
  return !pendingDeletes.has(key) && finished.has(key) === finishedView;
}

// Whether a session survives every active filter.
// Finished sessions are hidden from the normal list and are the only ones shown in the finished view; the toggle flips which set is visible.
export function sessionPasses(session: SessionSummary, c: FilterCriteria): boolean {
  const key = entityKey(session);
  if (!inView(key, c.finishedOnly, c.finished, c.pendingDeletes)) return false;
  if (c.pinnedOnly && !c.pinned.has(key)) return false;
  if (c.openOnly && !c.open?.has(key)) return false;
  if (c.liveOnly && !c.live?.has(key)) return false;
  if (c.setAsideOnly && !c.setAside?.has(key)) return false;
  if (c.worktreeOnly && worktreeMarkState(session) === null) return false;
  // The same question the row asks itself, through the same function — a second rule for "is this dead" would be able to disagree with the dimming.
  if (c.goneOnly && unstartableReason(session) === null) return false;
  if (c.siblingOnly && !session.isSibling) return false;
  if (c.prsOnly && session.prs.length === 0) return false;
  if (c.notedOnly && !c.notes?.has(key)) return false;
  if (c.dateFrom !== null || c.dateTo !== null) {
    const activity = new Date(session.lastActivity).getTime();
    if (c.dateFrom !== null && activity < c.dateFrom) return false;
    if (c.dateTo !== null && activity > c.dateTo) return false;
  }
  if (!c.text) return true;
  const note = c.notes?.get(key) ?? '';
  // The group name matches every session in that group, which is what makes typing one a way to reach it — the group headings themselves are not searchable, only the rows under them.
  const group = c.groupNames?.get(key) ?? '';
  // A PR by the reference its menus show, so its number finds the session that linked it.
  const prs = session.prs.map(prReference).join(' ');
  return `${session.title} ${session.firstMessage} ${session.cwd} ${session.id} ${note} ${group} ${prs}`
    .toLowerCase()
    .includes(c.text.toLowerCase());
}
