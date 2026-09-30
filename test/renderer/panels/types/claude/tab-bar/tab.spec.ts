import type { Locator, Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// What a tab does besides being chosen: its status dot says how its session is, and marks it read; a middle click takes the close button's two steps.
const one = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'The one on show' });
const other = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'The other one' });
const fixture = { sessions: [one, other], openSessions: [one.id, other.id], activeSession: one.id, history: { [one.id]: [], [other.id]: [] } };

const tab = (page: Page, title: string): Locator => page.locator('.tab', { has: page.locator('.tab-label', { hasText: title }) });

test("a tab's dot follows its session's status, and a click on it marks it read without choosing the tab", async ({ app, page }) => {
  await app.boot(fixture);
  const dot = tab(page, other.title).locator('.nudge');
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect(dot).not.toHaveClass(/\bwaiting\b/);

  expect(await app.emit('onSessionStatus', other.id, 'waiting', '')).toBe(1);
  await expect(dot).toHaveClass(/\bwaiting\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);

  // The tab is cold, so a click that reached it would start it as well as choose it.
  await dot.click();
  await expect(dot).toHaveClass(/\backed\b/);
  await dot.click();
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(tab(page, other.title)).not.toHaveClass(/\bactive\b/);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('a tab follows its session as the listing changes on disk: a new title renames it', async ({ app, page }) => {
  await app.boot({ sessions: [one, other], openSessions: [one.id, other.id] });
  await expect(tab(page, other.title)).toHaveCount(1);
  // As claude writing its title into the transcript would leave it, and main listing it again.
  await page.evaluate((id) => {
    const listed = window.__claudeUiFixture.sessions;
    window.__claudeUiFixture.sessions = listed.map((s) => (s.id === id ? { ...s, title: 'Renamed on disk' } : s));
  }, other.id);
  expect(await app.emit('onSessionsChanged')).toBe(1);
  await expect(tab(page, 'Renamed on disk')).toHaveCount(1);
  await expect(tab(page, other.title)).toHaveCount(0);
});

test('a middle click stops the tab of a running session, and closes it once it is cold', async ({ app, page }) => {
  await app.boot(fixture);
  await tab(page, other.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, 'claude is here')).toBe(1);
  await tab(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);

  await tab(page, other.title).click({ button: 'middle' });
  expect(await app.calls('closeTerminal')).toEqual([[1]]);
  await app.emit('onTerminalExit', 1, 0);
  await expect(tab(page, other.title)).toHaveClass(/\bcold\b/);
  // Not chosen by it: the tab on show stays on show.
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);

  await tab(page, other.title).click({ button: 'middle' });
  await expect(tab(page, other.title)).toHaveCount(0);
  expect(await app.calls('closeTerminal')).toEqual([[1]]);
});
