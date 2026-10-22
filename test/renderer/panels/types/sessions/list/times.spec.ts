import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// A row's time says how long ago, so it is drawn again as the clock moves rather than only when the list is (src/renderer/moments.ts), and its tooltip gives the moment in full.
const one = session();
const ACTIVE = Date.parse(one.lastActivity);
const MINUTE = 60_000;

const meta = (page: Page, title: string): Locator => row(page, title).locator('.meta-text');
/** A moment in full, as the window's own clock and zone write it. */
const inFull = (page: Page, at: number): Promise<string> => page.evaluate((ms) => new Date(ms).toLocaleString(), at);

test("a row's time ages with the clock, with nothing else moving", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  await app.boot({ sessions: [one] });
  await expect(meta(page, one.title)).toHaveText('5 min ago · Opus 5.5');
  await expect(meta(page, one.title)).toHaveAttribute('data-tooltip', await inFull(page, ACTIVE));

  await page.clock.fastForward('01:00:00');
  await expect(meta(page, one.title)).toHaveText('1 h ago · Opus 5.5');
});

test("a row's time follows its session's last activity, which on its own draws the list again nowhere", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  await app.boot({ sessions: [one] });
  await expect(meta(page, one.title)).toHaveText('5 min ago · Opus 5.5');

  // A message written now: the listing moves, and nothing the list draws again for.
  const busy = ACTIVE + 5 * MINUTE;
  await app.listOnDisk([{ ...one, lastActivity: new Date(busy).toISOString() }]);
  await page.clock.fastForward(MINUTE);
  await expect(meta(page, one.title)).toHaveText('1 min ago · Opus 5.5');
  await expect(meta(page, one.title)).toHaveAttribute('data-tooltip', await inFull(page, busy));
});

test("an archived row's time ages with the clock too, and its tooltip gives when it was archived", async ({ app, page }) => {
  const archivedAt = ACTIVE + MINUTE;
  await page.clock.install({ time: archivedAt + 5 * MINUTE });
  await app.boot({ sessions: [one], archived: { [one.id]: archivedAt }, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, archived: true } } });
  await expect(meta(page, one.title)).toHaveText('archived 5 min ago');
  await expect(meta(page, one.title)).toHaveAttribute('data-tooltip', await inFull(page, archivedAt));

  await page.clock.fastForward('03:00:00');
  await expect(meta(page, one.title)).toHaveText('archived 3 h ago');
});
