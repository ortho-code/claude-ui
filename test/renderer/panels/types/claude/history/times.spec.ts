import type { Exchange } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// An exchange's time says how long ago, and an exchange is drawn once and kept, so it is drawn again as the clock moves (src/renderer/moments.ts).
const one = session();
const TIME = '2026-09-30T08:00:00.000Z';
const MINUTE = 60_000;
const exchange: Exchange = { id: 'request-1', time: TIME, request: 'Run the checks', kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'text', id: 'message-1', time: TIME, text: 'All pass.' }] };

test("an exchange's time ages with the clock, and its tooltip gives the moment in full", async ({ app, page }) => {
  await page.clock.install({ time: Date.parse(TIME) + 5 * MINUTE });
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange] } });
  await page.getByRole('button', { name: 'Show history' }).click();
  const when = page.locator('.exchange-meta > span:not(.exchange-mark)');
  await expect(when).toHaveText('#1 · 5 min ago');
  await expect(when).toHaveAttribute('data-tooltip', await page.evaluate((iso) => new Date(iso).toLocaleString(), TIME));

  await page.clock.fastForward('02:00:00');
  await expect(when).toHaveText('#1 · 2 h ago');
});
