import type { Page } from '@playwright/test';
import type { ScheduledTask } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab } from '../../../../support/window';

// A pause or a stop of a session with a task scheduled sends the third Ctrl-C a `/loop` wakeup takes, so the stop lands, and asks nothing first: claude asks its own question for a cron, and the clock's tooltip says beforehand what becomes of each (docs/architecture.md, its section on stopping a session).
const one = session();
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { sessions: [one], history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;
const tock = { prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' };

/** Start the session from its row, let its claude print, and give it these tasks, as its last Stop would. */
async function start(page: Page, app: App, tasks: ScheduledTask[]): Promise<void> {
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  await app.emit('onSessionScheduled', one.id, tasks);
}

/** Choose an item of the session's menu, from its row's kebab. */
async function fromMenu(page: Page, item: 'Pause' | 'Stop session'): Promise<void> {
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: new RegExp(`^${item}$`) }).click();
}

// Every route that asks claude to leave: the tab's button and a middle click on the tab, the strip's button, and Pause and Stop session in the menu.
for (const [route, press, dot] of [
  ['the tab button', (page: Page) => tab(page, one.title).locator('.tab-close').click(), 'stopping'],
  ['a middle click on the tab', (page: Page) => tab(page, one.title).click({ button: 'middle' }), 'stopping'],
  ["the strip's button", (page: Page) => stripRow(page, one.title).locator('.strip-item-stop').click(), 'stopping'],
  ['Stop session in the menu', (page: Page) => fromMenu(page, 'Stop session'), 'stopping'],
  ['Pause in the menu', (page: Page) => fromMenu(page, 'Pause'), 'pausing'],
] as const) {
  test(`a session with a task scheduled, left from ${route}, gets three presses and no question`, async ({ app, page }) => {
    await app.boot(fixture);
    await start(page, app, [tock]);
    await press(page);
    await expect.poll(() => app.calls('closeTerminal')).toEqual([[FIRST, true]]);
    await expect(tab(page, one.title).locator('.nudge')).toHaveClass(new RegExp(`\\b${dot}\\b`));
    await expect(page.locator('#confirm-dialog')).toBeHidden();
  });
}

test('a session with nothing scheduled gets two presses, as before', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app, []);
  await tab(page, one.title).locator('.tab-close').click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
});
