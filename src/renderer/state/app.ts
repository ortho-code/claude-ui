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

export const store = createStore<AppState>({ sessions: [] }, { sessions: sameRows });
