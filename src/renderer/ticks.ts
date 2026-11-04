/**
 * The rules of ticking rows in the session list's bulk mode (docs/architecture.md § Selecting several), pure so they are unit-tested: which rows a Shift+press ticks, and what a heading's box shows of the rows under it.
 */

/**
 * The run of rows a Shift+press on `key` ticks: from the row last pressed (`anchor`) to `key`, both included, in the order the rows are drawn (`order`), whichever way up the press went.
 * Only `key` when there is no anchor, or the anchor is no longer drawn.
 */
export function tickedRun(order: readonly string[], anchor: string | null, key: string): string[] {
  const to = order.indexOf(key);
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (to < 0) return [key];
  if (from < 0) return [key];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** What a heading's box shows of the rows under it: every one ticked, some, or none; a heading with no rows shows none. */
export function headingTick(keys: readonly string[], ticked: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const count = keys.filter((key) => ticked.has(key)).length;
  if (count === 0) return 'none';
  return count === keys.length ? 'all' : 'some';
}

/** The ticked rows among those on show, in the order drawn: what the bar counts and acts on, so it never reaches a row out of sight. */
export function tickedOnShow(order: readonly string[], ticked: ReadonlySet<string>): string[] {
  return order.filter((key) => ticked.has(key));
}
