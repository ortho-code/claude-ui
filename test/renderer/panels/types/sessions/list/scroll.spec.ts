import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import type { UiState } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';

// The list keeps where you scrolled it, across a repaint and across a restart; a new filter starts it at its top, since the results it scrolled through are gone.
const NOW = new Date('2026-09-30T12:00:00.000Z');
const many = Array.from({ length: 40 }, (_, i) =>
  session({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, title: `Session ${String(i + 1).padStart(2, '0')}`, lastActivity: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString() }),
);
const fixture = { sessions: many };

const scrolled = (page: Page): Promise<number> => page.locator('#sessions').evaluate((list) => list.scrollTop);
const scrollTo = (page: Page, top: number): Promise<void> =>
  page.locator('#sessions').evaluate((list, to) => {
    list.scrollTop = to;
  }, top);
const savedScroll = async (app: App): Promise<number | undefined> => ((await app.calls('setUiState')).at(-1)?.[0] as UiState | undefined)?.scrollTop;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('a repaint keeps the scroll, and a new filter starts the list at its top', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#sessions .session')).toHaveCount(many.length);
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);

  // A status drawn on a row is not a new list.
  expect(await app.emit('onSessionStatus', many[0].id, 'waiting', '')).toBe(1);
  await expect(page.locator('#sessions .session').first().locator('.nudge')).toHaveClass(/\bwaiting\b/);
  expect(await scrolled(page)).toBe(400);

  // Each of these still lists every session, so the top is where the filter put it, not where a shorter list left it.
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Session');
  await expect.poll(() => scrolled(page)).toBe(0);
  await scrollTo(page, 400);
  await page.locator('#date-presets [data-range="30d"]').click();
  await expect.poll(() => scrolled(page)).toBe(0);
});

test('where the list was scrolled to is saved', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#sessions .session')).toHaveCount(many.length);
  await scrollTo(page, 300);
  await expect.poll(() => savedScroll(app)).toBe(300);
});

test('a scroll stored last time is where the list opens', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), scrollTop: 300 } });
  await expect(page.locator('#sessions .session')).toHaveCount(many.length);
  await expect.poll(() => scrolled(page)).toBe(300);
});
