import type { Exchange } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

const one = session();
const TIME = '2026-09-30T08:00:00.000Z';

test("a line break in claude's message is a line break in the history, as in the request above it", async ({ app, page }) => {
  const exchange: Exchange = {
    id: 'request-1',
    time: TIME,
    request: 'First line.\nSecond line.',
    kind: 'typed',
    replaced: false,
    rewound: false,
    parts: [{ kind: 'text', id: 'message-1', time: TIME, text: 'First sentence.\nSecond sentence.' }],
  };
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange] } });
  await page.getByRole('button', { name: 'Show history' }).click();

  expect(await page.locator('.exchange-request-text').innerText()).toBe('First line.\nSecond line.');
  expect(await page.locator('.exchange-text[data-id="message-1"] p').innerText()).toBe('First sentence.\nSecond sentence.');
});

test("a link in claude's message is handed to the app to open, from a click and from a middle-click, and the window's own default is stopped for both", async ({ app, page }) => {
  const exchange: Exchange = {
    id: 'request-1',
    time: TIME,
    request: 'Where is it written?',
    kind: 'typed',
    replaced: false,
    rewound: false,
    parts: [{ kind: 'text', id: 'message-1', time: TIME, text: 'In [the docs](https://example.com/docs).' }],
  };
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange] } });
  await page.getByRole('button', { name: 'Show history' }).click();
  // What each press is by the time it reaches the window, after the history's own handler: left to the window, a click navigates and a middle-click opens a window.
  await page.evaluate(() => {
    for (const type of ['click', 'auxclick']) {
      window.addEventListener(type, (event) => {
        document.body.dataset[type] = String(event.defaultPrevented);
      });
    }
  });

  const link = page.locator('.exchange-text[data-id="message-1"] a');
  await link.click();
  await link.click({ button: 'middle' });

  expect(await app.calls('openExternal')).toEqual([['https://example.com/docs'], ['https://example.com/docs']]);
  expect(await page.evaluate(() => [document.body.dataset.click, document.body.dataset.auxclick])).toEqual(['true', 'true']);
});
