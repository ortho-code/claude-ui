import { bootList, expect, sessionId, test } from './support/fixture';
import { loadNote, longestOver, measure, prepare, quantile, report, type Sample } from './support/measure';

/** Budget 194, held as the longest task (the design's decision 213): at most a frame, at any of the rates measured, at the 4× throttle too. */
const FRAME = 16;
const STATUS_CHANGES = 30;
const BURSTS = 5;
const BURST = 20;
const RENAMES = 10;
/** A minute and a little, so the window's minute clock comes round once inside it. */
const A_MINUTE = 61_000;

test('a live update holds no task longer than a frame', async ({ app, page, throttle }) => {
  await bootList(app, page);
  await prepare(page, throttle);

  // Each session's status changes on every visit, busy then idle then busy, so no event repeats the status a session already has.
  const status: Sample[] = [];
  for (let k = 0; k < STATUS_CHANGES; k++) status.push(await measure(page, `status ${k}`, { kind: 'status', id: sessionId(k % 10), busy: Math.floor(k / 10) % 2 === 0 }));
  // As parallel tool results bring them: twenty sessions' statuses in one task.
  const bursts: Sample[] = [];
  for (let k = 0; k < BURSTS; k++) bursts.push(await measure(page, `burst ${k}`, { kind: 'burst', ids: Array.from({ length: BURST }, (_, i) => sessionId(100 + k * BURST + i)) }));
  // A listing change that shows: one session's title, as a transcript getting its title brings it.
  const renames: Sample[] = [];
  for (let k = 0; k < RENAMES; k++) renames.push(await measure(page, `rename ${k}`, { kind: 'rename', id: sessionId(k * 7 + 1), title: `Renamed ${k}` }));

  report(`194, the longest task at ${throttle}×, 1,000 sessions`, [
    { event: 'a status change', values: status.map((s) => s.longest), budget: FRAME },
    { event: `${BURST} status changes at once`, values: bursts.map((s) => s.longest), budget: FRAME },
    // Whether 194 holds these is still open (plan § Still open 1), so they are measured and reported only.
    { event: 'a listing change', values: renames.map((s) => s.longest), budget: null },
  ]);
  const load = loadNote();
  const why = (event: string): string => `${event}, 95th percentile of its longest task${load ? ` (${load})` : ''}`;
  expect.soft(quantile(status.map((s) => s.longest), 0.95), why('a status change')).toBeLessThanOrEqual(FRAME);
  expect.soft(quantile(bursts.map((s) => s.longest), 0.95), why(`${BURST} status changes at once`)).toBeLessThanOrEqual(FRAME);
});

test("the minute's tick, measured", async ({ app, page, throttle }) => {
  test.setTimeout(3 * 60_000);
  await bootList(app, page);
  await prepare(page, throttle);
  // The window's own clock, which the page cannot be made to run sooner without faking the time the measuring reads; one tick, reported only (plan § Still open 1).
  const longest = await longestOver(page, A_MINUTE);
  report(`The minute's tick at ${throttle}×, 1,000 sessions`, [{ event: 'the longest task in a minute', values: [longest], budget: null }]);
});
