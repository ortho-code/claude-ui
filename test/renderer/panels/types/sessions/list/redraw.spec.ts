import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// A draw leaves a row that shows nothing new as it is, so each of these is something a row shows that can change while the row stays: after the change, the row says it.
const MINUTE = 60_000;
const one = session();
const ACTIVE = Date.parse(one.lastActivity);
/** Two searches that both keep `one`, so a key between them draws the list with the row kept. */
const KEEPING = ['A', 'A s'];

test("a status reported while the list stands still is in its row's tooltip after the next key", async ({ app, page }) => {
  await app.boot({ sessions: [one], statuses: { [one.id]: 'ready' } });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(KEEPING[0]);
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', /\nReady\n/);

  expect(await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, 'go on')).toBe(1);
  await page.locator('#search').fill(KEEPING[1]);
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', /\nBusy\n/);
});

test('a session last active again, with nothing else in the listing moved, says so on its row after the next key', async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 3 * 60 * MINUTE });
  await app.boot({ sessions: [one] });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(KEEPING[0]);
  await expect(row(page, one.title).locator('.meta-text')).toHaveText(/^3 h ago/);

  await app.listOnDisk([{ ...one, lastActivity: new Date(ACTIVE + 3 * 60 * MINUTE).toISOString() }]);
  await page.locator('#search').fill(KEEPING[1]);
  await expect(row(page, one.title).locator('.meta-text')).toHaveText(/^just now/);
});

test('a model switched mid-session shows on its row while a search keeps it', async ({ app, page }) => {
  await app.boot({ sessions: [one] });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(KEEPING[0]);
  await expect(row(page, one.title)).toContainText('Opus 5.5');

  expect(await app.emit('onSessionModel', one.id, 'claude-sonnet-5-5')).toBe(1);
  await expect(row(page, one.title)).toContainText('Sonnet 5.5');
});

test('a row a search left out comes back as the same row, its time as it is now, and goes on ticking', async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Other one' });
  await page.clock.install({ time: ACTIVE + 3 * 60 * MINUTE });
  await app.boot({ sessions: [one, other] });
  await row(page, one.title).evaluate((each) => each.setAttribute('data-probe', 'first'));
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(other.title);
  await expect(row(page, one.title)).toHaveCount(0);

  // An hour off the page, its time not ticking there.
  await page.clock.fastForward('01:00:00');
  await page.locator('#search').fill('');
  await expect(row(page, one.title)).toHaveAttribute('data-probe', 'first');
  await expect(row(page, one.title).locator('.meta-text')).toHaveText(/^4 h ago/);

  await page.clock.fastForward('01:00:00');
  await expect(row(page, one.title).locator('.meta-text')).toHaveText(/^5 h ago/);
});

test('a pin shows on its row while a search keeps it', async ({ app, page }) => {
  await app.boot({ sessions: [one] });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(KEEPING[0]);
  const pin = row(page, one.title).locator('.pin');
  await expect(pin).toHaveAttribute('data-tooltip', 'Pin');

  await pin.click();
  await expect(pin).toHaveAttribute('data-tooltip', 'Unpin');
});
