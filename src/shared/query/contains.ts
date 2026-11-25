/** How many values keep their pattern; a query holds a few, so this only bounds what typing leaves behind. */
const KEPT_PATTERNS = 64;

const patterns = new Map<string, RegExp>();

/**
 * Whether a text contains a value, without regard to capitals.
 * A pattern per value, kept while the value is among the last ones asked, so a query asking this of every text of every session makes no lower-cased copy of each text.
 */
export function containsIgnoringCase(text: string, value: string): boolean {
  let pattern = patterns.get(value);
  if (pattern === undefined) {
    if (patterns.size >= KEPT_PATTERNS) patterns.clear();
    pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    patterns.set(value, pattern);
  }
  return pattern.test(text);
}
