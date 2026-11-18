import { bootList, expect, test } from './support/fixture';
import { loadNote, measure, prepare, quantile, report, type Sample } from './support/measure';

/** Budget 193: a key in the query field has its frame within 50 ms, and within 200 ms at the 4× throttle (the design's decisions 193, 197, 198). */
const BUDGET = { normal: 50, throttled: 200 };
/** "thing " keeps every row, "1" drops most of them, "x" the rest; erasing brings them back. */
const TYPED = 'thing 1x';
const ROUNDS = 3;

/** What a key did to the rows, the three costs the budget was measured on. */
function kindOf(sample: Sample): string {
  if (sample.rowsAfter === sample.rowsBefore) return 'a key that keeps every row';
  return sample.rowsAfter < sample.rowsBefore ? 'a key that drops rows' : 'a key that brings rows back';
}

test('a key in the query field draws within its budget', async ({ app, page, throttle }) => {
  await bootList(app, page);
  await page.locator('#filter-toggle').click();
  await prepare(page, throttle);

  const samples: Sample[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    for (let at = 1; at <= TYPED.length; at++) samples.push(await measure(page, `typed ${TYPED.slice(0, at)}`, { kind: 'type', text: TYPED.slice(0, at) }));
    for (let at = TYPED.length - 1; at >= 0; at--) samples.push(await measure(page, `erased to ${TYPED.slice(0, at)}`, { kind: 'type', text: TYPED.slice(0, at) }));
  }

  const budget = throttle > 1 ? BUDGET.throttled : BUDGET.normal;
  const kinds = new Map<string, Sample[]>();
  for (const sample of samples) kinds.set(kindOf(sample), [...(kinds.get(kindOf(sample)) ?? []), sample]);
  report(
    `193, a key's frame at ${throttle}×, 1,000 sessions`,
    [...kinds].map(([event, each]) => ({ event, values: each.map((s) => s.frame), budget })),
  );
  const load = loadNote();
  for (const [event, each] of kinds) {
    expect.soft(quantile(each.map((s) => s.frame), 0.95), `${event}, 95th percentile of its frame${load ? ` (${load})` : ''}`).toBeLessThanOrEqual(budget);
  }
});
