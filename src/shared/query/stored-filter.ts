/** A filter pill, by the key the stored filter kept it under. */
export type PillKey = 'pinned' | 'open' | 'live' | 'setAside' | 'worktree' | 'gone' | 'siblings' | 'prs' | 'noted';

/** The term each pill writes into the query, and wrote for the stored filter it replaces. */
export const PILL_TERMS: Readonly<Record<PillKey, string>> = {
  pinned: 'is:pinned',
  open: 'is:working',
  live: 'is:running',
  setAside: 'is:set-aside',
  worktree: 'is:worktree',
  gone: 'is:gone',
  siblings: 'is:sibling',
  prs: 'has:pr',
  noted: 'has:note',
};

/** The term each rolling date preset writes. */
export const PRESET_TERMS: Readonly<Record<'today' | '7d' | '30d', string>> = {
  today: 'active:today',
  '7d': 'active:>=today-7d',
  '30d': 'active:>=today-30d',
};

/** A pill stored under another key before its word changed. */
const PILLS_BEFORE: Partial<Record<PillKey, string>> = { live: 'running', setAside: 'later' };

/** A moment as a query's date, in local time. */
export function dateTerm(ms: number): string {
  const day = new Date(ms);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

/**
 * The query a filter stored before the query field says: the search's words, each pill on as its term, and the date preset as its `active:` terms, a custom range by its days; an unknown preset says nothing.
 * Read once, from a `meta.json` that has no query yet.
 */
export function queryFromStoredFilter(ui: Readonly<Record<string, unknown>>): string {
  const filters = (ui.filters && typeof ui.filters === 'object' ? ui.filters : {}) as Record<string, unknown>;
  const on = (key: PillKey): boolean => filters[key] === true || (filters[key] === undefined && PILLS_BEFORE[key] !== undefined && filters[PILLS_BEFORE[key]] === true);
  const terms = (Object.keys(PILL_TERMS) as PillKey[]).filter(on).map((key) => PILL_TERMS[key]);
  const preset = ui.datePreset;
  if (preset === 'today' || preset === '7d' || preset === '30d') terms.push(PRESET_TERMS[preset]);
  if (preset === 'custom') {
    if (typeof ui.dateFrom === 'number') terms.push(`active:>=${dateTerm(ui.dateFrom)}`);
    if (typeof ui.dateTo === 'number') terms.push(`active:<=${dateTerm(ui.dateTo)}`);
  }
  const search = typeof ui.search === 'string' ? ui.search.trim() : '';
  return [search, ...terms].filter((part) => part !== '').join(' ');
}
