import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { lookOf } from '../../../../support/looks';
import { tab } from '../../../../support/window';

// A tab carries its session's menu, the one its row in the list has, from a kebab beside its button and from a right-click on it, so a tab can be paused where it is.
const one = session();
const long = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'A session whose title is far too long to fit on any tab in the bar' });
const history = { [one.id]: [], [long.id]: [] };

test("a tab's kebab opens its session's menu without selecting the tab, and Pause from it pauses the tab", async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], history });
  await tab(page, one.title).locator('.tab-kebab').click();
  await expect(page.locator('.kebab-menu button', { hasText: 'Archive' })).toBeVisible();
  await expect(tab(page, one.title)).not.toHaveClass(/\bactive\b/);

  await page.locator('.kebab-menu button', { hasText: /^Pause$/ }).click();
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("a right-click on a tab's title opens the same menu", async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], history });
  await tab(page, one.title).locator('.tab-label').click({ button: 'right' });
  await expect(page.locator('.kebab-menu button', { hasText: 'Archive' })).toBeVisible();
  await expect(page.locator('.kebab-menu button', { hasText: /^Pause$/ })).toBeVisible();
  await expect(tab(page, one.title).locator('.tab-kebab')).toHaveClass(/\bmenu-open\b/);
});

test('a tab keeps its hover look while its menu is up', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], history });
  const tabEl = tab(page, one.title);
  await tabEl.locator('.tab-label').hover();
  const hovered = await lookOf(tabEl);
  await tabEl.locator('.tab-kebab').click();
  await page.locator('.kebab-menu button').first().hover();
  expect(await lookOf(tabEl)).toEqual(hovered);
});

test("a tab with a long title is capped at 212px, the old 200px and its kebab's 12px, which sits right against the tab's button", async ({ app, page }) => {
  await app.boot({ sessions: [long], openSessions: [long.id], history });
  const box = (await tab(page, long.title).boundingBox())!;
  expect(Math.round(box.width)).toBe(212);
  const kebab = (await tab(page, long.title).locator('.tab-kebab').boundingBox())!;
  const button = (await tab(page, long.title).locator('.tab-close').boundingBox())!;
  expect(Math.round(button.x - (kebab.x + kebab.width))).toBe(0);
});
