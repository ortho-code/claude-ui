/**
 * Main's rules for the marks a session carries in meta — its pin, its finished entry, its note (written with `withText`, src/shared/helpers/text.ts), its needs-you and set-aside marks, and when it was kept out of the review — pure, so that the window's checks answer them the way main does, and the window keeps its own copy of the needs-you, set-aside and keep marks by them.
 * Main (src/main/sessions/meta.ts, src/main/status/marks.ts) applies them inside its serialised writes of `meta.json`.
 */
import { isPrReason } from './needs-you';
import { prFromUrl, prKey, referenceKey } from '../sessions/prs';
import type { SetAside, NeedsYou, ScheduledTask, SessionPr, SettledBy, SettledNeedsYou } from '../types';
import type { SetAsideNews } from '../config/settings';

/** The marks, as `meta.json` holds them. */
export interface SessionMarks {
  pinned: string[];
  finished: Record<string, number>;
  notes: Record<string, string>;
  needsYou: Record<string, NeedsYou[]>;
  /** Each session's settled reasons, newest first, the newest `HISTORY_KEPT` kept. */
  needsYouHistory: Record<string, SettledNeedsYou[]>;
  setAside: Record<string, SetAside>;
  /** When each session was last kept out of the review, epoch ms; how long that holds is the review's own term (`kept:<30d`), not the mark's. */
  kept: Record<string, number>;
  /** The PRs the app linked each session to, such as the one a panel's row started it for, in the order linked. */
  prLinks: Record<string, SessionPr[]>;
}

/** A session's PR links with the PR at `url` added, read from its page (`prFromUrl`); as they were for an address that is no GitHub pull request page, an empty id, or a PR linked already (`prKey`). */
export function withPrLink(prLinks: Readonly<Record<string, SessionPr[]>>, id: string, url: string): Record<string, SessionPr[]> {
  const pr = prFromUrl(url);
  const linked = prLinks[id] ?? [];
  if (id === '' || pr === null || linked.some((each) => prKey(each) === prKey(pr))) return { ...prLinks };
  return { ...prLinks, [id]: [...linked, pr] };
}

/** Sessions kept out of the review from `at`: a stamp already there is replaced, so Keep again starts its days afresh. */
export function keptFrom(kept: Readonly<Record<string, number>>, ids: readonly string[], at: number): Record<string, number> {
  return { ...kept, ...Object.fromEntries(ids.map((id) => [id, at])) };
}

/** Sessions' keep stamps gone, whether or not each had one. */
export function unkept(kept: Readonly<Record<string, number>>, ids: readonly string[]): Record<string, number> {
  const next = { ...kept };
  for (const id of ids) delete next[id];
  return next;
}

/** A pin toggled: in if it was out, out if it was in, the order of the rest kept. */
export function togglePinned(pinned: readonly string[], id: string): string[] {
  const set = new Set(pinned);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

/** A finished entry there, from `now`, or from when it was finished before, so finishing it again is no change. */
export function finishedFrom(finished: Readonly<Record<string, number>>, id: string, now: number): Record<string, number> {
  return id in finished ? { ...finished } : { ...finished, [id]: now };
}

/** What a reason replaces when it is added: how the app closed replaces how it closed before, and a PR's change every reason of that PR's before, however either spells it (`referenceKey`). */
function kindOf(reason: NeedsYou): string {
  return isPrReason(reason) ? `pr:${referenceKey(reason.pr)}` : reason.type;
}

/**
 * Sessions marked as needing you for `reasons`: each added beside the reasons a session already has, replacing one of its kind, so a session picked up again still says every reason it needed you for (decided 2026-10-29).
 * No sessions or no reasons is no change.
 */
export function markedNeedsYou(needsYou: Readonly<Record<string, readonly NeedsYou[]>>, ids: readonly string[], reasons: readonly NeedsYou[]): Record<string, NeedsYou[]> {
  const next = Object.fromEntries(Object.entries(needsYou).map(([id, list]) => [id, [...list]]));
  if (reasons.length === 0) return next;
  const kinds = new Set(reasons.map(kindOf));
  for (const id of ids) next[id] = [...(next[id] ?? []).filter((reason) => !kinds.has(kindOf(reason))), ...reasons];
  return next;
}

/** How many settled reasons a session's history keeps, the newest: weeks to months of one session's reasons at the rate measured on 2026-11-06, and bounded, so a history never only grows. */
export const HISTORY_KEPT = 20;

/** A session's standing reasons and its history, as main changes them together, in one write. */
export type NeedsYouMarks = Pick<SessionMarks, 'needsYou' | 'needsYouHistory'>;

/** The histories copied, each list its own, so a change to one leaves what it was copied from as it was. */
function copied(history: Readonly<Record<string, readonly SettledNeedsYou[]>>): Record<string, SettledNeedsYou[]> {
  return Object.fromEntries(Object.entries(history).map(([key, list]) => [key, [...list]]));
}

/** A session's history with `settled` put in front, newest first, the newest `HISTORY_KEPT` kept. */
function withSettled(history: Readonly<Record<string, readonly SettledNeedsYou[]>>, id: string, settled: readonly SettledNeedsYou[]): Record<string, SettledNeedsYou[]> {
  const next = copied(history);
  if (settled.length === 0) return next;
  next[id] = [...settled, ...(next[id] ?? [])].slice(0, HISTORY_KEPT);
  return next;
}

/** Whether two reasons are the same one: of one type, marked at one moment, for one PR, however either spells it, or one close. */
export function sameReason(a: NeedsYou, b: NeedsYou): boolean {
  return a.type === b.type && a.at === b.at && (isPrReason(a) && isPrReason(b) ? referenceKey(a.pr) === referenceKey(b.pr) : true) && (a.type === 'app.was-running' && b.type === 'app.was-running' ? a.how === b.how : true);
}

/** `markedNeedsYou`, with each reason a new one replaces moved to its session's history as `replaced`, at `now`. */
export function markedWithHistory(marks: NeedsYouMarks, ids: readonly string[], reasons: readonly NeedsYou[], now: number): NeedsYouMarks {
  const needsYou = markedNeedsYou(marks.needsYou, ids, reasons);
  let needsYouHistory = copied(marks.needsYouHistory);
  for (const id of new Set(ids)) {
    const replaced = (marks.needsYou[id] ?? []).filter((reason) => !needsYou[id]!.includes(reason));
    needsYouHistory = withSettled(needsYouHistory, id, replaced.map((reason) => ({ ...reason, settled: now, by: 'replaced' as const })));
  }
  return { needsYou, needsYouHistory };
}

/** A session's mark taken off, every reason moved to its history, settled at `now` by `by`; no change for a session with none. */
export function settledNeedsYou(marks: NeedsYouMarks, id: string, by: SettledBy, now: number): NeedsYouMarks {
  const standing = marks.needsYou[id] ?? [];
  return { needsYou: clearedNeedsYou(marks.needsYou, id), needsYouHistory: withSettled(marks.needsYouHistory, id, standing.map((reason) => ({ ...reason, settled: now, by }))) };
}

/** Every session's reasons of `types` taken off, the others left, each into its session's history as settled `off` at `now`: what switching a type off does to the marks it already made (decided 2026-11-06). */
export function settledTypes(marks: NeedsYouMarks, types: readonly string[], now: number): NeedsYouMarks {
  const off = new Set(types);
  let needsYouHistory = copied(marks.needsYouHistory);
  const needsYou: Record<string, NeedsYou[]> = {};
  for (const [id, reasons] of Object.entries(marks.needsYou)) {
    const settled = reasons.filter((reason) => off.has(reason.type));
    const kept = reasons.filter((reason) => !off.has(reason.type));
    if (kept.length > 0) needsYou[id] = kept;
    needsYouHistory = withSettled(needsYouHistory, id, settled.map((reason) => ({ ...reason, settled: now, by: 'off' as const })));
  }
  return { needsYou, needsYouHistory };
}

/** A session's reasons put back as they were, as Undo of a close or a finish does, and taken back off its history, so an undone close leaves no trace there. */
export function restoredNeedsYou(marks: NeedsYouMarks, id: string, reasons: readonly NeedsYou[]): NeedsYouMarks {
  const needsYouHistory = copied(marks.needsYouHistory);
  const kept = (needsYouHistory[id] ?? []).filter((entry) => !reasons.some((reason) => sameReason(entry, reason)));
  if (kept.length > 0) needsYouHistory[id] = kept;
  else delete needsYouHistory[id];
  return { needsYou: markedNeedsYou(marks.needsYou, [id], reasons), needsYouHistory };
}

/** When a session's newest reason was marked; 0 for none. */
function newestAt(reasons: readonly NeedsYou[]): number {
  return Math.max(0, ...reasons.map((reason) => reason.at));
}

/** A needs-you mark gone, every reason with it, whether or not it was there. */
export function clearedNeedsYou<T extends readonly NeedsYou[]>(needsYou: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const next = { ...needsYou };
  delete next[id];
  return next;
}

/** A session set aside, until `due` or whenever for null, from `now`: a mark already there is replaced, so what it mutes is what needed you by now (`mutedBySetAside`). */
export function markedSetAside(setAside: Readonly<Record<string, SetAside>>, id: string, due: number | null, now: number): Record<string, SetAside> {
  return { ...setAside, [id]: { due, at: now } };
}

/** A set-aside mark gone, whether or not it was there. */
export function clearedSetAside(setAside: Readonly<Record<string, SetAside>>, id: string): Record<string, SetAside> {
  const next = { ...setAside };
  delete next[id];
  return next;
}

/**
 * The set-aside marks come due by `now` settled: each goes, and its session needs you — for what it already needed you for, if anything, or else for the reminder, marked from the moment it was due.
 * A session that already needs you gets no reminder beside its reasons: the set-aside mark going is what lights them up again (decided 2026-10-29).
 * With `remind` false, the reminder's type switched off, the marks still go and nothing is marked for them.
 */
export function cameDue(marks: { needsYou: Readonly<Record<string, readonly NeedsYou[]>>; setAside: Readonly<Record<string, SetAside>> }, now: number, remind = true): Pick<SessionMarks, 'needsYou' | 'setAside'> {
  const due = Object.entries(marks.setAside).filter(([, mark]) => mark.due !== null && mark.due <= now);
  const needsYou = Object.fromEntries(Object.entries(marks.needsYou).map(([id, reasons]) => [id, [...reasons]]));
  if (due.length === 0) return { needsYou, setAside: { ...marks.setAside } };
  const setAside = { ...marks.setAside };
  for (const [id, mark] of due) {
    delete setAside[id];
    if (remind && !needsYou[id]?.length) needsYou[id] = [{ type: 'app.reminder', at: mark.due! }];
  }
  return { needsYou, setAside };
}

/**
 * Whether a session's needs-you mark is muted by its set-aside mark: every reason came before you set it aside, so you have seen why and chose to come back to it (decided 2026-10-29).
 * A reason that came after it is news the set-aside mark did not know of: with `news` at `show` none is muted, and at `wait` it is muted with the rest until the day comes (decided 2026-11-12).
 */
export function mutedBySetAside(needsYou: readonly NeedsYou[] | undefined, setAside: SetAside | undefined, news: SetAsideNews): boolean {
  if (needsYou === undefined || needsYou.length === 0 || setAside === undefined) return false;
  return news === 'wait' || newestAt(needsYou) <= setAside.at;
}

/** A finished entry gone, whether or not it was there. */
export function clearedFinished(finished: Readonly<Record<string, number>>, id: string): Record<string, number> {
  const next = { ...finished };
  delete next[id];
  return next;
}

/** A deleted session's marks forgotten: its pin, its finished entry, its note, its needs-you mark and its history, its set-aside mark, its keep stamp and its PR links (`purgedSession` forgets the rest of what meta holds about it). */
export function withoutSession(marks: Readonly<SessionMarks>, id: string): SessionMarks {
  const finished = clearedFinished(marks.finished, id);
  const notes = { ...marks.notes };
  delete notes[id];
  const needsYouHistory = copied(marks.needsYouHistory);
  delete needsYouHistory[id];
  const prLinks = { ...marks.prLinks };
  delete prLinks[id];
  return { pinned: marks.pinned.filter((key) => key !== id), finished, notes, needsYou: clearedNeedsYou(marks.needsYou, id), needsYouHistory, setAside: clearedSetAside(marks.setAside, id), kept: unkept(marks.kept, [id]), prLinks };
}

/** What else meta holds about a session, as `meta.json` holds it: the tabs open and which of them run, the one on show overall and per project, and who is in which group. */
export interface SessionPlaces {
  openSessions: string[];
  runningSessions: string[];
  scheduledWhenStopped: Record<string, ScheduledTask[]>;
  activeSession: string | null;
  activeSessionByProject: Record<string, string>;
  groupOf: Record<string, string>;
}

/** Everything meta holds about a deleted session forgotten, its marks with the rest: main's purge (`purgeSession`, src/main/sessions/meta.ts), and the window checks' stand-in's. */
export function purgedSession(meta: Readonly<SessionMarks & SessionPlaces>, id: string): SessionMarks & SessionPlaces {
  const groupOf = { ...meta.groupOf };
  delete groupOf[id];
  return {
    ...withoutSession(meta, id),
    openSessions: meta.openSessions.filter((key) => key !== id),
    runningSessions: meta.runningSessions.filter((key) => key !== id),
    scheduledWhenStopped: Object.fromEntries(Object.entries(meta.scheduledWhenStopped).filter(([key]) => key !== id)),
    activeSession: meta.activeSession === id ? null : meta.activeSession,
    activeSessionByProject: Object.fromEntries(Object.entries(meta.activeSessionByProject).filter(([, key]) => key !== id)),
    groupOf,
  };
}
