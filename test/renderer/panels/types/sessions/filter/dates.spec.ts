import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// The date filter narrows the list by when a session was last active: a rolling preset (today, the last 7 or 30 days) or a custom range picked on the calendar, which is the one kept as it was picked; a preset is worked out again from the moment it is restored.
const NOW = new Date('2026-09-30T12:00:00.000Z');
const today = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Active today', lastActivity: '2026-09-30T09:00:00.000Z' });
const days3 = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Three days ago', lastActivity: '2026-09-27T12:00:00.000Z' });
const days20 = session({ id: '00000000-0000-4000-8000-0000000000d3', title: 'Twenty days ago', lastActivity: '2026-09-10T12:00:00.000Z' });
const old = session({ id: '00000000-0000-4000-8000-0000000000d4', title: 'Months ago', lastActivity: '2026-06-01T12:00:00.000Z' });
const everyone = [today, days3, days20, old];
const fixture = { sessions: everyone };

const titles = async (page: Page): Promise<string[]> => (await page.locator('#sessions .session .session-title').allTextContents()).sort();
const sorted = (...list: { title: string }[]): string[] => list.map((s) => s.title).sort();
const preset = (page: Page, range: string): Locator => page.locator(`#date-presets [data-range="${range}"]`);
/** A day on the calendar on show, by its date in September 2026 (month 8, counted from 0). */
const day = (page: Page, date: number): Locator => page.locator(`#date-range .air-datepicker-cell.-day-[data-year="2026"][data-month="8"][data-date="${date}"]`);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('a preset narrows the list to what was active in it, and Any gives it all back', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();

  await preset(page, 'today').click();
  await expect(preset(page, 'today')).toHaveClass(/\bactive\b/);
  await expect.poll(() => titles(page)).toEqual(sorted(today));
  await preset(page, '7d').click();
  await expect.poll(() => titles(page)).toEqual(sorted(today, days3));
  await preset(page, '30d').click();
  await expect.poll(() => titles(page)).toEqual(sorted(today, days3, days20));
  await expect(page.locator('#filter-count')).toHaveText('Showing 3 of 4');

  // Shut over it, the chip says what the preset's button says.
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filter-chips .filter-chip-text')).toHaveText(['30d']);
  await page.locator('#filter-toggle').click();

  await preset(page, 'any').click();
  await expect.poll(() => titles(page)).toEqual(sorted(...everyone));
  await expect(page.locator('#filter-status')).toBeHidden();
});

test('a custom range picked on the calendar narrows the list to it and names it', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  await preset(page, 'custom').click();
  // Custom only chooses the mode: the range's own line opens the calendar.
  await expect(page.locator('#date-range-label')).toHaveText('Pick a start and end date');
  await expect(page.locator('#date-custom')).toBeHidden();
  await page.locator('#date-range-label').click();
  await expect(page.locator('#date-custom')).toBeVisible();

  await day(page, 9).click();
  await day(page, 11).click();
  await expect.poll(() => titles(page)).toEqual(sorted(days20));
  await expect(page.locator('#date-range-label')).toHaveText('09-09-2026 – 11-09-2026');

  // Dismissed, the range stays applied.
  await page.keyboard.press('Escape');
  await expect(page.locator('#date-custom')).toBeHidden();
  await expect.poll(() => titles(page)).toEqual(sorted(days20));
});

test("the calendar starts at the oldest session's day, and follows the listing as it changes", async ({ app, page }) => {
  // All in the month on show, so the first day that can be picked is on the calendar.
  await app.boot({ sessions: [today, days3, days20] });
  await page.locator('#filter-toggle').click();
  await preset(page, 'custom').click();
  await page.locator('#date-range-label').click();
  await expect(day(page, 9)).toHaveClass(/-disabled-/);
  await expect(day(page, 10)).not.toHaveClass(/-disabled-/);

  const older = session({ id: '00000000-0000-4000-8000-0000000000d5', title: 'Older still', lastActivity: '2026-09-05T12:00:00.000Z' });
  await page.evaluate((added) => {
    window.__claudeUiFixture.sessions = [...window.__claudeUiFixture.sessions, added];
  }, older);
  expect(await app.emit('onSessionsChanged')).toBe(1);
  await expect(day(page, 9)).not.toHaveClass(/-disabled-/);
  await expect(day(page, 4)).toHaveClass(/-disabled-/);
});

test('a stored custom range comes back as it was picked', async ({ app, page }) => {
  const from = new Date(2026, 8, 9).getTime();
  const to = new Date(2026, 8, 11, 23, 59, 59, 999).getTime();
  await app.boot({ ...fixture, uiState: { ...defaultUi(), datePreset: 'custom', dateFrom: from, dateTo: to } });
  await expect.poll(() => titles(page)).toEqual(sorted(days20));
  await expect(page.locator('#date-range-label')).toHaveText('09-09-2026 – 11-09-2026');
  await expect(page.locator('#filter-count')).toHaveText('Showing 1 of 4');
});

test('a stored rolling preset is worked out again from now, not from the range it last stored', async ({ app, page }) => {
  // A range from the epoch would let every session through.
  await app.boot({ ...fixture, uiState: { ...defaultUi(), datePreset: '7d', dateFrom: 0, dateTo: null } });
  await expect.poll(() => titles(page)).toEqual(sorted(today, days3));
});
