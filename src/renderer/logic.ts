// Pure sidebar logic, kept free of DOM/globals so it can be unit-tested. renderer.ts wires these
// to its state and the DOM.
import type { SessionSummary } from '../shared/types';

// Collapse sessions to one entry per conversation: the active tip (latest activity).
export function tipsByConversation(sessions: SessionSummary[]): Map<string, SessionSummary> {
  const tips = new Map<string, SessionSummary>();
  for (const s of sessions) {
    const prev = tips.get(s.conversationId);
    if (!prev || s.lastActivity > prev.lastActivity) tips.set(s.conversationId, s);
  }
  return tips;
}

// The list's structure: one line per session for the fields that affect what the sidebar shows.
// Excludes lastActivity/eventCount so a running session writing its transcript isn't a "change".
export function structuralSignature(sessions: SessionSummary[]): string {
  return sessions
    .map((s) => `${s.conversationId}\0${s.id}\0${s.cwd}\0${s.title}\0${s.firstMessage}`)
    .sort()
    .join('\n');
}

// Group by repo root so a repo's worktrees (and subdirectories) file under one heading.
export function groupByRepo(sessions: SessionSummary[]): [string, SessionSummary[]][] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const list = groups.get(session.repoRoot) ?? [];
    list.push(session);
    groups.set(session.repoRoot, list);
  }
  return [...groups.entries()];
}

// The group's short name: the last path segment of its repo root.
export function groupName(repoRoot: string): string {
  return repoRoot.split('/').filter(Boolean).pop() ?? repoRoot;
}

// A short "x min ago" relative time. `now` is injectable for tests.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

// The [from, to] window for a date preset, rolling from `now`. 'any' and 'custom' have no preset
// bounds ('custom' is read from the date inputs by the caller).
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
  worktreeOnly: boolean;
  archivedOnly: boolean;
  dateFrom: number | null;
  dateTo: number | null;
  pinned: ReadonlySet<string>;
  /** Set or Map keyed by conversationId; only membership is used. */
  archived: { has(key: string): boolean };
  pendingDeletes: ReadonlySet<string>;
}

// Whether a session survives every active filter. Archived sessions are hidden from the normal
// list and are the only ones shown in the archived view; the toggle flips which set is visible.
export function sessionPasses(session: SessionSummary, c: FilterCriteria): boolean {
  if (c.pendingDeletes.has(session.conversationId)) return false;
  if (c.archivedOnly !== c.archived.has(session.conversationId)) return false;
  if (c.pinnedOnly && !c.pinned.has(session.conversationId)) return false;
  if (c.worktreeOnly && !session.worktree) return false;
  if (c.dateFrom !== null || c.dateTo !== null) {
    const activity = new Date(session.lastActivity).getTime();
    if (c.dateFrom !== null && activity < c.dateFrom) return false;
    if (c.dateTo !== null && activity > c.dateTo) return false;
  }
  if (!c.text) return true;
  return `${session.title} ${session.firstMessage} ${session.cwd} ${session.id}`
    .toLowerCase()
    .includes(c.text.toLowerCase());
}

// A folder's rolled-up nudge for the switcher: the strongest UNATTENDED status among its sessions,
// so a folder you're not looking at still shows it needs you. Priority waiting > idle > busy; null
// when nothing needs surfacing. An acked (read) session is muted and contributes nothing.
export type NudgeStatus = 'waiting' | 'idle' | 'busy' | null;

export interface SwitcherFolder {
  repoRoot: string;
  name: string;
  count: number;
  badge: NudgeStatus;
}

export interface SwitcherModel {
  all: { count: number; badge: NudgeStatus };
  folders: SwitcherFolder[];
}

function rollUpNudge(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
): NudgeStatus {
  let waiting = false;
  let idle = false;
  let busy = false;
  for (const s of sessions) {
    if (acked.has(s.id)) continue; // read/muted — contributes nothing
    switch (statuses.get(s.id)) {
      case 'waiting':
        waiting = true;
        break;
      case 'idle':
        idle = true;
        break;
      case 'busy':
        busy = true;
        break;
    }
  }
  return waiting ? 'waiting' : idle ? 'idle' : busy ? 'busy' : null;
}

// Build the group-switcher model from the VISIBLE tips (one per conversation, already filtered to
// what the sidebar shows). Folders order by recency: the input is recency-sorted, so a folder takes
// the position of its most-recent session (first appearance). Per folder: session count + the
// rolled-up nudge badge; plus an "All" aggregate over everything passed.
export function foldersForSwitcher(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
): SwitcherModel {
  const order: string[] = [];
  const byRoot = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    let list = byRoot.get(s.repoRoot);
    if (!list) {
      list = [];
      byRoot.set(s.repoRoot, list);
      order.push(s.repoRoot);
    }
    list.push(s);
  }
  const folders = order.map((repoRoot) => {
    const list = byRoot.get(repoRoot)!;
    return { repoRoot, name: groupName(repoRoot), count: list.length, badge: rollUpNudge(list, statuses, acked) };
  });
  return {
    all: { count: sessions.length, badge: rollUpNudge(sessions, statuses, acked) },
    folders,
  };
}
