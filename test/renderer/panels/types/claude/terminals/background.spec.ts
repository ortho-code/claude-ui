import type { Locator, Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { lookOf, token } from '../../../../support/looks';
import { row, stripRow, switcherEntry, tab } from '../../../../support/window';

// A turn that ends with work still running behind it, such as a shell or a subagent it sent off, reports `background` in idle's place (docs/architecture.md § Status cues).
// Every dot standing for the session says so alike, naming what runs; nothing calls it finished until that work has ended and a turn of its own has.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { sessions: [one, two], history: { [one.id]: [], [two.id]: [] } };

/** The session's own dots: its tab's, its row's and its strip row's. */
const dots = (page: Page, title: string): Locator[] => [tab(page, title), row(page, title), stripRow(page, title)].map((at) => at.locator('.nudge'));
const toasts = (page: Page): Locator => page.locator('#notifications .notif');

/** Start each session from its row and let its claude print, so it runs; the last one started is on show. */
async function startBoth(page: Page, app: App): Promise<void> {
  for (const [i, s] of [one, two].entries()) {
    await row(page, s.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(i + 1);
    expect(await app.emit('onTerminalData', i + 1, 'claude is here')).toBe(1);
  }
  await expect(tab(page, two.title)).toHaveClass(/\bactive\b/);
}

test('a turn ending with work behind it shows background on every dot of the session, naming the work', async ({ app, page }) => {
  await app.boot(fixture);
  await startBoth(page, app);

  await app.emit('onSessionStatus', one.id, 'background', '', 'Stop', ['shell', 'subagent', 'shell']);
  // Busy's spinning arc around idle's green: the turn is done, and work still goes on.
  const look = { background: await token(page, '--idle'), border: await token(page, '--accent') };
  for (const dot of dots(page, one.title)) {
    await expect(dot).toHaveClass(/\bbackground\b/);
    await expect(dot).toHaveAttribute('data-tooltip', 'Working in the background: 2 shells, 1 subagent');
    expect(await lookOf(dot)).toMatchObject(look);
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('spin');
  }
  // Working, as far as the project's roll-up goes: not finished, and nothing to toast on a tab not on show.
  await expect(switcherEntry(page, 'demo').locator('.nudge')).toHaveClass(/\bbusy\b/);
  await expect(toasts(page)).toHaveCount(0);

  // Its end starts a turn of its own, and only that turn's end is the session finishing.
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit');
  for (const dot of dots(page, one.title)) await expect(dot).toHaveAttribute('data-tooltip', 'Busy');
  await app.emit('onSessionStatus', one.id, 'idle', '', 'Stop');
  for (const dot of dots(page, one.title)) await expect(dot).toHaveAttribute('data-tooltip', 'Idle');
  await expect(toasts(page)).toHaveCount(1);
});

// A status read back at launch says what it is, but not what ran: only a status event carries that.
test('background work nothing was told about is named only as background work', async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'background' } });
  await expect(row(page, one.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Working in the background');
});

// A read mark mutes a finished or waiting session; work still running has nothing to read yet.
test('a dot showing background work cannot be marked read', async ({ app, page }) => {
  await app.boot(fixture);
  await startBoth(page, app);
  await app.emit('onSessionStatus', one.id, 'background', '', 'Stop', ['shell']);

  const dot = row(page, one.title).locator('.nudge');
  // Forced, since a spinning dot never holds still for the wait Playwright makes before a click.
  await dot.click({ force: true });
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(dot).toHaveAttribute('data-tooltip', 'Working in the background: 1 shell');

  // The same dot, once the session has finished, is marked read by a click, so it is the background state that keeps the one above from marking it.
  await app.emit('onSessionStatus', one.id, 'idle', '', 'Stop');
  await dot.click();
  await expect(dot).toHaveClass(/\backed\b/);
});
