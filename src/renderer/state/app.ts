import type { SessionSummary } from '../../shared/types';
import { structuralSignature } from '../logic';
import { createStore } from './store';

/**
 * The window's shared state (docs/architecture.md § The store): what more than one surface draws, or what a surface draws and another changes.
 * A slice holds a value that is replaced, never changed in place, since a change in place tells nobody.
 */
export interface AppState {
  /** Every session the listing read from disk, the tips of families included, as main lists them. */
  sessions: SessionSummary[];
  /** Session id -> its status as its hooks last reported it (busy, idle, waiting, …); a session with none is absent. */
  statuses: ReadonlyMap<string, string>;
  /** Sessions whose dot you marked read: dimmed, not pulsing. In memory only, so a restart lights everything again; any status event clears a session's mark. */
  acked: ReadonlySet<string>;
  /**
   * Session id -> the model it switched to while the app was watching.
   * A transcript records which model ANSWERED, never which one was chosen, so `/model` leaves no trace in it until the next reply — and the row went on naming the old model in between.
   * `PostModelSwitch` is the only place that answer exists at the moment it becomes true, so it is kept here and preferred over the transcript's.
   * In memory only: it can never be staler than what is on disk (every switch in this app's sessions lands here), and after a restart the transcript's own last answer is the right source again.
   */
  switchedModel: ReadonlyMap<string, string>;
}

/** `map` with `key` set to `value`, or without it for `undefined`: a copy when that changes anything, the same map when it does not, so nobody is told for nothing. */
export function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): ReadonlyMap<K, V> {
  if (value === undefined ? !map.has(key) : map.get(key) === value) return map;
  const next = new Map(map);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}

/** `set` with `key` in it or not: a copy when that changes anything, the same set when it does not. */
export function withMember<T>(set: ReadonlySet<T>, key: T, member: boolean): ReadonlySet<T> {
  if (set.has(key) === member) return set;
  const next = new Set(set);
  if (member) next.add(key);
  else next.delete(key);
  return next;
}

/** The slices a repaint is handed: the ones it is told about and the ones it reads. */
export type View<K extends keyof AppState> = Readonly<Pick<AppState, K>>;

const signatures = new WeakMap<SessionSummary[], string>();

/**
 * Whether two listings draw the same rows: their structural signature (`AFFECTS_ROW` in logic.ts), computed once per listing.
 * The sessions slice tells its readers only when this says no, so a transcript merely growing — its `lastActivity` moving — repaints nothing, for every reader alike, while `get` still has the newest listing.
 */
export function sameRows(a: SessionSummary[], b: SessionSummary[]): boolean {
  const of = (sessions: SessionSummary[]): string => {
    let signature = signatures.get(sessions);
    if (signature === undefined) {
      signature = structuralSignature(sessions);
      signatures.set(sessions, signature);
    }
    return signature;
  };
  return of(a) === of(b);
}

/** Whether two maps hold the same entries: a map read afresh from main is a new object even when nothing in it moved. */
function sameEntries<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value || !b.has(key)) return false;
  return true;
}

export const store = createStore<AppState>({ sessions: [], statuses: new Map(), acked: new Set(), switchedModel: new Map() }, { sessions: sameRows, statuses: sameEntries });
