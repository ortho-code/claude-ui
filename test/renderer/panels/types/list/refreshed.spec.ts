import type { Locator, Page } from '@playwright/test';
import { type App, expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { bootList } from './list';

// A list panel's header says how long ago its list came from a run, beside Refresh, with the moment in full in its tooltip and in Refresh's.
// The checks' browser runs in nl-NL (playwright.config.ts).
const LIST = { version: 1, sections: [{ items: [{ key: 'a', text: 'README.md' }] }] };
const START = new Date(2026, 9, 29, 15, 30).getTime();
const MINUTE = 60_000;

const header = (page: Page): Locator => page.locator('.panel-header', { has: page.locator('.panel-title', { hasText: 'Changes' }) });
const refreshed = (page: Page): Locator => header(page).locator('.panel-refreshed');
const refresh = (page: Page): Locator => header(page).getByRole('button', { name: 'Refresh' });

/** Press Refresh and wait for the run it starts, handing back its token. */
async function rerun(app: App, page: Page, count: number): Promise<string> {
  await refresh(page).click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(count);
  return (await runs(app, 'changes'))[count - 1].token;
}

test('the header says how long ago the list came, ageing with the clock, with the moment in its tooltip and in Refresh’s', async ({ app, page }) => {
  await page.clock.install({ time: START });
  await bootList(app, page, LIST);
  await expect(refreshed(page)).toHaveText('just now');
  await expect(refreshed(page)).toHaveAttribute('data-tooltip', 'Refreshed: do 29 okt, 15:30');
  await expect(refresh(page)).toHaveAttribute('data-tooltip', 'Refresh\nLast refreshed: do 29 okt, 15:30');

  await page.clock.fastForward(3 * MINUTE);
  await expect(refreshed(page)).toHaveText('3 min ago');
});

test('a run under way keeps the time of the list on show', async ({ app, page }) => {
  await page.clock.install({ time: START });
  await bootList(app, page, LIST);
  await page.clock.fastForward(3 * MINUTE);
  await rerun(app, page, 2);
  await expect(header(page).locator('.nudge.running')).toBeVisible();
  await expect(refreshed(page)).toHaveText('3 min ago');
});

test("a failed run keeps the time of the list still on show, and the tooltip says when the run failed", async ({ app, page }) => {
  await page.clock.install({ time: START });
  await bootList(app, page, LIST);
  await page.clock.fastForward(3 * MINUTE);
  const token = await rerun(app, page, 2);
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 1, signal: null });
  await expect(header(page).locator('.panel-end')).toHaveText('exit 1');
  await expect(refreshed(page)).toHaveText('3 min ago');
  await expect(refreshed(page)).toHaveAttribute('data-tooltip', 'Refreshed: do 29 okt, 15:30\nThe run at 15:33 failed');
  await expect(refresh(page)).toHaveAttribute('data-tooltip', 'Refresh\nLast refreshed: do 29 okt, 15:30');
});

test('a header too narrow for the time and the whole title drops the time, which Refresh’s tooltip still gives', async ({ app, page }) => {
  await page.clock.install({ time: START });
  const title = 'Changes in every checkout this session touched';
  await bootList(app, page, LIST, { entry: { title } });
  const titled = page.locator('.panel-header', { has: page.locator('.panel-title', { hasText: title }) });
  await expect(titled.locator('.panel-refreshed')).toBeHidden();
  const cut = await titled.locator('.panel-title').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(cut).toBe(true);
  await expect(titled.getByRole('button', { name: 'Refresh' })).toHaveAttribute('data-tooltip', 'Refresh\nLast refreshed: do 29 okt, 15:30');
});
