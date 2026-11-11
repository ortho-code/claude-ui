import type { Exchange, HistoryPin } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { goLive } from '../../../../support/live';
import { historyAtTop, tab } from '../../../../support/window';

// The history's head: the switch between every request and the pinned ones, the steps between requests, and the way back to live.
const one = session();
const TIME = '2026-09-30T08:00:00.000Z';
/** Long enough that a few of them overflow the history, so a step has somewhere to go. */
const reply = Array.from({ length: 40 }, (_, line) => `Line ${line + 1}`).join('\n\n');
const exchange = (id: string): Exchange => ({ id, time: TIME, request: `Request ${id}`, kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'text', id: `message-${id}`, time: TIME, text: reply }] });
const pin = (text: string): HistoryPin => ({ kind: 'request', session: one.id, text, time: TIME, pinnedAt: 0 });

test('Previous and Next request step between the requests, and a step back and forth comes back to the same one', async ({ app, page }) => {
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: ['1', '2', '3', '4'].map(exchange) } });
  await page.getByRole('button', { name: 'Show history' }).click();
  const previous = page.getByRole('button', { name: 'Previous request (Ctrl+Shift+↑)' });
  await previous.click();
  const first = await historyAtTop(page);
  await previous.click();
  const second = await historyAtTop(page);
  expect(second).not.toBe(first);
  await page.getByRole('button', { name: 'Next request (Ctrl+Shift+↓)' }).click();
  expect(await historyAtTop(page)).toBe(first);
});

test('Pinned shows only the requests holding a pin and says it is on, and All shows every one again', async ({ app, page }) => {
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: ['1', '2', '3'].map(exchange) }, historyPins: { '2': pin('Request 2') } });
  await page.getByRole('button', { name: 'Show history' }).click();
  const all = page.locator('.history-filter', { hasText: /^All/ });
  const pinned = page.locator('.history-filter', { hasText: /Pinned/ });
  await expect(all).toHaveText('All 3');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.exchange:visible')).toHaveCount(3);

  await pinned.click();
  await expect(pinned).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.exchange:visible .exchange-request-text')).toHaveText(['Request 2']);

  await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.exchange:visible')).toHaveCount(3);
});

test('Back to live closes the history over a live session', async ({ app, page }) => {
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange('1')] } });
  await goLive(page, app, tab(page, one.title));
  await page.keyboard.press('Control+Shift+ArrowUp');
  const history = page.locator('.history');
  await expect(history).toHaveClass(/\bshown\b/);
  await page.getByRole('button', { name: /^Back to live/ }).click();
  await expect(history).not.toHaveClass(/\bshown\b/);
});
