import type { HistoryPin, PrSeen, ScheduledTask, SessionPr, UiState } from '../../shared/types';
import { finishedFrom, clearedSetAside, purgedSession, settledNeedsYou, togglePinned, clearedFinished, withPrLink } from '../../shared/status/sessionmarks';
import { withText } from '../../shared/helpers/text';
import type { WindowBounds } from '../window/bounds';
import { normalizeUi } from '../window/uistate';
import { scheduledBySession } from '../status/storedmarks';
import { needsYouUsage } from '../logs/usage';
import { decided, readMeta, serialize, update, type MetaSettings } from './metastore';
import { prSeenOf } from './storedprs';

export function getPinned(): Promise<string[]> {
  return serialize(async () => (await readMeta()).pinned);
}

export function togglePin(id: string): Promise<string[]> {
  return update('togglePin', (meta) => {
    meta.pinned = togglePinned(meta.pinned, id);
    return meta.pinned;
  });
}

/** How much of what was pinned a pin keeps: enough to recognise it in a list of pins, and a pin stays a few hundred bytes. */
const HISTORY_PIN_TEXT = 300;

export function getHistoryPins(): Promise<Record<string, HistoryPin>> {
  return serialize(async () => (await readMeta()).historyPins);
}

/**
 * Pin request or message `id` with what a list of pins shows of it, or unpin it if it is pinned.
 * The pin arrives from the window, so a malformed one is refused here, the same way a malformed stored one is dropped on read.
 */
export function toggleHistoryPin(id: string, pin: Pick<HistoryPin, 'kind' | 'session' | 'text' | 'time'>): Promise<Record<string, HistoryPin>> {
  // Typed as what the window should send; checked as what it might.
  const given = pin as Partial<Record<keyof typeof pin, unknown>> | undefined;
  return update('toggleHistoryPin', (meta) => {
    if (id in meta.historyPins) {
      delete meta.historyPins[id];
    } else if (id && (given?.kind === 'request' || given?.kind === 'reply') && typeof given.session === 'string' && typeof given.text === 'string' && typeof given.time === 'string') {
      meta.historyPins[id] = { kind: given.kind, session: given.session, text: given.text.slice(0, HISTORY_PIN_TEXT), time: given.time, pinnedAt: Date.now() };
    }
    return meta.historyPins;
  });
}

export function getFinished(): Promise<Record<string, number>> {
  return serialize(async () => (await readMeta()).finished);
}

/** Mark sessions finished, in one write, which settles anything each needed you for, and what you set it aside for: a finished session is put away. */
export function finish(ids: string[]): Promise<Record<string, number>> {
  return update('finish', (meta, usage) => {
    const now = Date.now();
    const needsYouBefore = meta.needsYou;
    usage.push(...decided('finish', ids.filter((id) => !(id in meta.finished))));
    for (const id of ids) {
      meta.finished = finishedFrom(meta.finished, id, now);
      Object.assign(meta, settledNeedsYou(meta, id, 'finished', now));
      meta.setAside = clearedSetAside(meta.setAside, id);
    }
    usage.push(...needsYouUsage(needsYouBefore, meta.needsYou, { by: 'finished' }));
    return meta.finished;
  });
}

/** Make sessions unfinished, in one write; `by` says a session resumed in claude did, rather than you. */
export function unfinish(ids: string[], by?: 'resume'): Promise<Record<string, number>> {
  return update('unfinish', (meta, usage) => {
    usage.push(...decided('unfinish', ids.filter((id) => id in meta.finished), by));
    for (const id of ids) meta.finished = clearedFinished(meta.finished, id);
    return meta.finished;
  });
}

/**
 * Drop a session from all metadata (used when it is deleted), by the rule the window's checks answer with too (`purgedSession`, src/shared/status/sessionmarks.ts).
 * History pins stay: they are keyed by the request or message, which a fork sibling may still carry, and telling which pins nothing opens any more needs every transcript read — a job for a list of every pin, not for a delete.
 */
export function purgeSession(id: string): Promise<void> {
  return update('purgeSession', (meta) => {
    Object.assign(meta, purgedSession(meta, id));
  });
}

export function getOpenSessions(): Promise<string[]> {
  return serialize(async () => (await readMeta()).openSessions);
}

/** The sessions that were running when the open tabs were last written; see `runningSessions`. */
export function getRunningSessions(): Promise<string[]> {
  return serialize(async () => (await readMeta()).runningSessions);
}

/** The crons the open tabs whose claude went had scheduled; see `scheduledWhenStopped`. */
export function getScheduledWhenStopped(): Promise<Record<string, ScheduledTask[]>> {
  return serialize(async () => (await readMeta()).scheduledWhenStopped);
}

/** Keep the crons the open tabs whose claude went had scheduled, each read as claude's own list is read (`scheduledTasksOf`), for the open sessions only. */
export function setScheduledWhenStopped(bySession: Record<string, unknown>): Promise<void> {
  return update('setScheduledWhenStopped', (meta) => {
    meta.scheduledWhenStopped = Object.fromEntries(Object.entries(scheduledBySession(bySession)).filter(([id]) => meta.openSessions.includes(id)));
  });
}

/** What was last seen of the PRs; see `prSeen`. */
export function getPrSeen(): Promise<PrSeen | null> {
  return serialize(async () => (await readMeta()).prSeen);
}

/** Keep what was last seen of the PRs, in place of what was kept before. */
export function setPrSeen(seen: PrSeen): Promise<void> {
  return update('setPrSeen', (meta) => {
    meta.prSeen = prSeenOf(seen) ?? {};
  });
}

/** The PRs the app linked each session to; see `prLinks`. */
export function getPrLinks(): Promise<Record<string, SessionPr[]>> {
  return serialize(async () => (await readMeta()).prLinks);
}

/** Link a session to the PR at `url`, by `withPrLink`'s rule. */
export function addPrLink(id: string, url: string): Promise<void> {
  return update('addPrLink', (meta) => {
    meta.prLinks = withPrLink(meta.prLinks, id, url);
  });
}

/** The open tabs and which of them run, in one write, so the two lists are never from different moments. */
export function setOpenSessions(ids: string[], running: string[]): Promise<void> {
  return update('setOpenSessions', (meta) => {
    meta.openSessions = ids;
    // Only an open tab runs anything, or keeps what was scheduled when its claude went.
    meta.runningSessions = running.filter((id) => ids.includes(id));
    meta.scheduledWhenStopped = Object.fromEntries(Object.entries(meta.scheduledWhenStopped).filter(([id]) => ids.includes(id)));
    // A tab that is no longer open cannot be the one to reopen on — globally or for its project.
    if (meta.activeSession && !ids.includes(meta.activeSession)) meta.activeSession = null;
    meta.activeSessionByProject = Object.fromEntries(
      Object.entries(meta.activeSessionByProject).filter(([, id]) => ids.includes(id)),
    );
  });
}

export function getActiveSession(): Promise<string | null> {
  return serialize(async () => (await readMeta()).activeSession);
}

export function getActiveSessionByProject(): Promise<Record<string, string>> {
  return serialize(async () => (await readMeta()).activeSessionByProject);
}

/** Remember a session as the one to return to — overall, and within its own project. */
export function setActiveSession(id: string | null, repoRoot?: string): Promise<void> {
  return update('setActiveSession', (meta) => {
    meta.activeSession = id;
    if (id && repoRoot) meta.activeSessionByProject[repoRoot] = id;
  });
}

export function getActiveProject(): Promise<string | null> {
  return serialize(async () => (await readMeta()).activeProject);
}

export function setActiveProject(repoRoot: string | null): Promise<void> {
  return update('setActiveProject', (meta) => {
    meta.activeProject = repoRoot;
  });
}

export function getNotes(): Promise<Record<string, string>> {
  return serialize(async () => (await readMeta()).notes);
}

/**
 * Write a session's note, or clear it.
 * Blank (or whitespace-only) DELETES the entry rather than storing an empty string, so "has a note" stays a simple presence check and the row's mark can't linger over nothing.
 * Finishing keeps a note (it's still the same session); a fork inherits none, since it gets a new id and notes are keyed by id.
 */
export function setNote(id: string, note: string): Promise<Record<string, string>> {
  return update('setNote', (meta) => {
    meta.notes = withText(meta.notes, id, note);
    return meta.notes;
  });
}

export function getWindowBounds(): Promise<WindowBounds | null> {
  return serialize(async () => (await readMeta()).windowBounds);
}

/**
 * Remember where the window is.
 * Written through the same queue as everything else, so a resize landing at the same moment as a tab change cannot overwrite it — the reason this lives in meta.json at all rather than in a file of its own.
 */
export function setWindowBounds(bounds: WindowBounds): Promise<void> {
  return update('setWindowBounds', (meta) => {
    meta.windowBounds = bounds;
  });
}

export function getUiState(): Promise<UiState> {
  return serialize(async () => (await readMeta()).ui);
}

/**
 * Store the sidebar's view state.
 * Normalized on the way in, so a renderer bug cannot write a shape the next launch can't read.
 */
export function setUiState(state: UiState): Promise<void> {
  return update('setUiState', (meta) => {
    meta.ui = normalizeUi(state);
  });
}

/** The preferences as kept here before they moved into the config folder: read by that move (settings.ts), and by nothing else. */
export function getSettings(): Promise<MetaSettings> {
  return serialize(async () => (await readMeta()).settings);
}

/** What has moved from here into the config folder, by name (`launchFlags`), so each move is made once and a later reset of the app's file there does not bring the old value back. */
export function getMoved(): Promise<string[]> {
  return serialize(async () => (await readMeta()).moved);
}

/** Record that `name` has moved into the config folder; what it moved from stays where it was, so an older build still finds it. */
export function markMoved(name: string): Promise<void> {
  return update(`moved ${name}`, (meta) => {
    if (!meta.moved.includes(name)) meta.moved.push(name);
  });
}
