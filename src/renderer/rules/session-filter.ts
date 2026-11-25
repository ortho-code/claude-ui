/**
 * Whether a session is in the set a view holds before any filter: the finished view holds the finished sessions, the normal view the rest, and a session on its way to the trash is in neither.
 * One rule for the list, the switcher's counts and the filter count's total, so the total is always the set the matches were taken from.
 */
export function inView(key: string, finishedView: boolean, finished: { has(key: string): boolean }, pendingDeletes: ReadonlySet<string>): boolean {
  return !pendingDeletes.has(key) && finished.has(key) === finishedView;
}
