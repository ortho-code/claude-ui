import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/config/defaults';
import { session, settingsFileWith } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// A row's time says how long ago, so it is drawn again as the clock moves rather than only when the list is (src/renderer/ui/moments.ts), and the row's tooltip says what the moment is and gives it in full.
const one = session();
const ACTIVE = Date.parse(one.lastActivity);
const MINUTE = 60_000;

const meta = (page: Page, title: string): Locator => row(page, title).locator('.meta-text');
/** A line of the row's tooltip, whole. */
const tipLine = (line: string): RegExp => new RegExp(`(^|\\n)${line}(\\n|$)`);

test("a row's time ages with the clock, with nothing else moving", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  await app.boot({ sessions: [one] });
  await expect(meta(page, one.title)).toHaveText('5 min ago · Opus 5.5');
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', tipLine('Last active: wo 30 sep, 10:00'));

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
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', tipLine('Last active: wo 30 sep, 10:05'));
});

test("a row's tooltip gives the moment in the language of the settings, following a change of it at once", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  await app.boot({ sessions: [one] });
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', tipLine('Last active: wo 30 sep, 10:00'));

  await app.settingsOnDisk(settingsFileWith('settings.json', { locale: 'en-US' }));
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', tipLine('Last active: Wed, Sep 30, 10:00 AM'));
});

test("a finished row's time ages with the clock too, and its tooltip gives when it was finished", async ({ app, page }) => {
  const finishedAt = ACTIVE + MINUTE;
  await page.clock.install({ time: finishedAt + 5 * MINUTE });
  await app.boot({ sessions: [one], finished: { [one.id]: finishedAt }, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, finished: true } } });
  await expect(meta(page, one.title)).toHaveText('finished 5 min ago');
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', tipLine('Finished: wo 30 sep, 10:01'));
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', tipLine('Last active: wo 30 sep, 10:00'));

  await page.clock.fastForward('03:00:00');
  await expect(meta(page, one.title)).toHaveText('finished 3 h ago');
});
