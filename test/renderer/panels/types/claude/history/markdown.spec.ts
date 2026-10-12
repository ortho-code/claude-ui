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
