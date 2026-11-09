import { DEFAULT_STRENGTH, expandedStrength, NEEDS_YOU } from '../../shared/status/looks';
import { NO_NEEDS_YOU_TYPES, PR_TYPES } from '../../shared/status/needsyou';
import type { NeedsYou } from '../../shared/types';

/** A needs-you reason as a dot shows it: `needs:` and its type, so what a dot shows stays one word a surface can compare, and the type is there for its look. */
export type NeedsShown = `needs:${string}`;

/** A reason of `type` as a dot shows it. */
export const needsShown = (type: string): NeedsShown => `needs:${type}`;

/** Whether what a dot shows is a needs-you reason. */
export const isNeeds = (shown: string | null | undefined): shown is NeedsShown => shown?.startsWith('needs:') === true;

/** The strength order as it ranks (`expandedStrength`), and the category each type belongs to, which places a reason in it. */
export interface Strength {
  order: readonly string[];
  categoryOf: (type: string) => string | null;
}

/** The order before the settings and the categories are read: the default, every reason at `needs-you`'s place. */
export const DEFAULT_RANKING: Strength = { order: expandedStrength(DEFAULT_STRENGTH, NO_NEEDS_YOU_TYPES), categoryOf: () => null };

/**
 * Where a state ranks in the order, lower first: a status at its own place, a reason at its category's, or at `needs-you`'s for a category the order does not hold; a status the order does not know, last.
 * No status at all ranks as `closed`, which draws the same.
 */
export function rankOf(state: string | undefined, strength: Strength): number {
  if (isNeeds(state)) {
    const at = strength.order.indexOf(strength.categoryOf(state.slice('needs:'.length)) ?? NEEDS_YOU);
    return at === -1 ? strength.order.indexOf(NEEDS_YOU) : at;
  }
  const at = strength.order.indexOf(state ?? 'closed');
  return at === -1 ? Number.POSITIVE_INFINITY : at;
}

/** Where a PR type is named among those found in one answer, strongest first (`PR_TYPES`); any other type before them all. */
const prPlace = (type: string): number => Object.keys(PR_TYPES).indexOf(type);

/** A session's reasons as the order ranks them: by their category's place, then newest first, and within one answer in the order the PR types are named in. */
export function rankedReasons(reasons: readonly NeedsYou[], strength: Strength): NeedsYou[] {
  const rank = (reason: NeedsYou): number => rankOf(needsShown(reason.type), strength);
  return [...reasons].sort((a, b) => rank(a) - rank(b) || b.at - a.at || prPlace(a.type) - prPlace(b.type));
}

/**
 * What a session's dot shows of its claude's status and its needs-you reasons, one rule for its dot and for every roll-up: the first in the strength order that holds, a reason by its category, the strongest category's newest reason (decided 2026-11-06).
 * With the default order that is the mark where claude says nothing more pressing: busy and background show over it, since claude is then working, and waiting does, since claude then asks you something; ready, closed and no status at all give way to it.
 * A status the order does not know shows as itself where no reason does, so a state nobody named still reads in its tooltip.
 */
export function shownState(status: string | undefined, reasons: readonly NeedsYou[], strength: Strength): string | undefined {
  const strongest = rankedReasons(reasons, strength)[0];
  if (strongest === undefined) return status;
  const reason = needsShown(strongest.type);
  return rankOf(reason, strength) < rankOf(status, strength) ? reason : status;
}

/**
 * Whether a dot showing `status` shows the session's mark read, by its tooltip and its dimming alike (`sessionDotClass`).
 * A dot showing what its tab does, stopping, never does: it reports a claude on its way out, so there is nothing on it to have read, and a mark made before would dim it for nothing.
 */
export function showsRead(status: string | null | undefined, acked: boolean): boolean {
  return acked && status !== 'stopping';
}
