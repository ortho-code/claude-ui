import type { Locator } from '@playwright/test';
import type { Exchange } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { historyFold } from '../../../../support/window';

// What one exchange of the history draws: the marks on its request line, the stars that pin its request and claude's messages, and its folds as claude's reply grows.
const one = session();
const TIME = '2026-09-30T08:00:00.000Z';
const exchange = (id: string, over: Partial<Exchange> = {}): Exchange => ({ id, time: TIME, request: `Request ${id}`, kind: 'typed', replaced: false, rewound: false, parts: [], ...over });

test('a request sent while claude worked, sent again or rewound past says so on its line, with what it means on hover', async ({ app, page }) => {
  await app.boot({
    openSessions: [one.id],
    activeSession: one.id,
    history: { [one.id]: [exchange('busy', { kind: 'busy' }), exchange('replaced', { replaced: true }), exchange('rewound', { rewound: true }), exchange('plain')] },
  });
  await page.getByRole('button', { name: 'Show history' }).click();
  const marksOf = (id: string): Locator => page.locator('.exchange', { hasText: `Request ${id}` }).locator('.exchange-mark');
  await expect(marksOf('busy')).toHaveText(['sent while claude was working']);
  await expect(marksOf('replaced')).toHaveText(['sent again']);
  await expect(marksOf('rewound')).toHaveText(['rewound']);
  await expect(marksOf('plain')).toHaveCount(0);
  await expect(page.locator('.exchange.left-behind')).toHaveCount(2);
  await marksOf('replaced').hover();
  await expect(page.locator('#tooltip')).toHaveText('You stopped this and sent it again: the request below replaced it.');
});

test("a press on a request's star or a message's star pins it, fills the star and counts it under Pinned, and a second press unpins it", async ({ app, page }) => {
  await app.boot({
    openSessions: [one.id],
    activeSession: one.id,
    history: { [one.id]: [exchange('request-1', { parts: [{ kind: 'text', id: 'message-1', time: TIME, text: 'A reply' }] })] },
  });
  await page.getByRole('button', { name: 'Show history' }).click();
  // A star shows on hover until it is pinned, so each is hovered before it is pressed.
  const requestStar = page.locator('.exchange-request .exchange-pin');
  const message = page.locator('.exchange-text[data-id="message-1"]');
  const messageStar = message.locator(':scope > .exchange-pin');
  const pinned = page.locator('.history-filter', { hasText: /Pinned/ });
  await expect(pinned).toHaveText('Pinned 0');
  await expect(requestStar).toHaveAttribute('aria-label', 'Pin this request');

  await page.locator('.exchange-request').hover();
  await requestStar.click();
  await expect(requestStar).toHaveAttribute('aria-pressed', 'true');
  await expect(requestStar).toHaveAttribute('aria-label', 'Unpin this request');
  await expect(page.locator('.exchange')).toHaveClass(/\bpinned\b/);
  await expect(pinned).toHaveText('Pinned 1');

  await message.hover();
  await messageStar.click();
  await expect(messageStar).toHaveAttribute('aria-label', 'Unpin this message');
  await expect(message).toHaveClass(/\bpinned\b/);
  await expect(pinned).toHaveText('Pinned 2');

  await page.locator('.exchange-request').hover();
  await requestStar.click();
  await expect(requestStar).toHaveAttribute('aria-pressed', 'false');
  await expect(pinned).toHaveText('Pinned 1');
  expect((await app.calls('toggleHistoryPin')).map(([id]) => id)).toEqual(['request-1', 'message-1', 'request-1']);
});

test("a fold opened by hand stays open while claude's reply grows under it", async ({ app, page }) => {
  const tools: Exchange['parts'] = [
    { kind: 'tool', name: 'Bash', detail: 'npm test' },
    { kind: 'tool', name: 'Read', detail: '/repo/src/a.ts' },
  ];
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange('request-1', { parts: tools })] } });
  await page.getByRole('button', { name: 'Show history' }).click();
  const run = historyFold(page, 'Ran 1 shell command, read 1 file');
  await run.head.click();
  await expect(run.body).toBeVisible();

  // Claude goes on: the same exchange, with a message after the run, read again as main sends the last exchange again.
  await page.evaluate((id) => {
    const [last] = window.__claudeUiFixture.history[id];
    last.parts = [...last.parts, { kind: 'text', id: 'message-1', time: last.time, text: 'All pass.' }];
  }, one.id);
  expect(await app.emit('onSessionsChanged')).toBe(1);
  await expect(page.locator('.exchange-text[data-id="message-1"]')).toBeVisible();
  await expect(run.head).toHaveAttribute('aria-expanded', 'true');
  await expect(run.body).toBeVisible();
});
