import type { Exchange, HistoryPin } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

const one = session();
const TIME = '2026-09-30T08:00:00.000Z';
const exchanges: Exchange[] = [
  {
    id: 'request-1',
    time: TIME,
    request: 'A pinned request',
    kind: 'typed',
    replaced: false,
    rewound: false,
    parts: [
      { kind: 'text', id: 'message-1', time: TIME, text: 'A pinned reply' },
      { kind: 'text', id: 'message-2', time: TIME, text: 'A reply nobody pinned' },
    ],
  },
];
const pin = (kind: HistoryPin['kind'], text: string): HistoryPin => ({ kind, session: one.id, text, time: TIME, pinnedAt: 0 });

// A closed history is hidden by visibility and slid off past the pane's right edge, kept laid out so the bar can measure it; a star that said `visible` showed through it there, over the next panel's rail (fixed in 18869bf).
test('a pinned star shows only while its history does, and never through a closed one', async ({ app, page }) => {
  await app.boot({
    openSessions: [one.id],
    activeSession: one.id,
    history: { [one.id]: exchanges },
    historyPins: { 'request-1': pin('request', 'A pinned request'), 'message-1': pin('reply', 'A pinned reply') },
  });
  const history = page.locator('.history');
  const pinned = [page.locator('.exchange-request .exchange-pin'), page.locator('.exchange-text[data-id="message-1"] > .exchange-pin')];
  const unpinned = page.locator('.exchange-text[data-id="message-2"] > .exchange-pin');

  // Resume the restored tab and let its claude print, so the history lies over a live terminal: the drawer, which is where it happened, rather than a history standing in for a cold tab.
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, 'Claude Code\r\n')).toBe(1);
  await expect(page.locator('.exchange')).toHaveCount(1);

  // Closed from the start, drawn all the same.
  await expect(history).toBeHidden();
  for (const star of pinned) await expect(star).toBeHidden();

  await page.getByRole('button', { name: /^Your last request/ }).click();
  await page.mouse.move(0, 0);
  await expect(history).toBeVisible();
  await expect(history).not.toHaveClass(/standalone/);
  for (const star of pinned) await expect(star).toBeVisible();
  await expect(unpinned).toBeHidden();

  // Mid-slide, held there: the drawer is still on screen, and a pinned star leaves with it rather than before it.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.history-leave')!.click();
    for (const animation of document.getAnimations()) animation.pause();
  });
  await expect(history).not.toHaveClass(/\bshown\b/);
  await expect(history).toBeVisible();
  for (const star of pinned) await expect(star).toBeVisible();

  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await expect(history).toBeHidden();
  for (const star of pinned) await expect(star).toBeHidden();
});
