import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../src/shared/config/defaults';
import { unstartableReason } from '../../../../../src/renderer/rules/sessions';
import type { TerminalLaunch } from '../../../../../src/shared/types';
import { HOME, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { row, tab, toastButton } from '../../../support/window';

// Reopen makes a finished session unfinished and opens it, in one press, from its row's button or its menu, and a toast says so, with an Undo that finishes it again.
const done = session({ title: 'Fix the login redirect' });
const FINISHED_AT = Date.parse('2026-10-01T08:00:00.000Z');
// A tab on show has its history read; what it holds is not what is checked here.
const finishedView = {
  sessions: [done],
  history: { [done.id]: [] },
  finished: { [done.id]: FINISHED_AT },
  uiState: { ...defaultUi(), finished: true },
};
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

const reopenButton = (page: Page): Locator => row(page, done.title).locator('.reopen-btn');

async function menuItem(page: Page, label: string): Promise<Locator> {
  await row(page, done.title).locator('.session-kebab').click();
  return page.locator('.kebab-menu button.menu-row', { hasText: new RegExp(`^${label}$`) });
}

/** The session reopened: unfinished in one write, resumed in a tab on show, and the toast saying so. */
async function expectReopened(app: App, page: Page): Promise<void> {
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.calls('unfinish')).toEqual([[[done.id]]]);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(done.id);
  await expect(tab(page, done.title)).toHaveClass(/\bactive\b/);
  await expect(page.locator('#toast-message')).toHaveText(`Reopened "${done.title}"; it is no longer finished`);
  // Out of the finished view, as Unfinished takes it.
  await expect(row(page, done.title)).toHaveCount(0);
}

test("a finished row's Reopen makes it unfinished and opens it, and a toast says so", async ({ app, page }) => {
  await app.boot(finishedView);
  await expect(reopenButton(page)).toHaveAttribute('data-tooltip', 'Reopen: make it unfinished and open it');
  await reopenButton(page).click();
  await expectReopened(app, page);
});

test("Reopen in a finished session's menu does what the row's button does", async ({ app, page }) => {
  await app.boot(finishedView);
  await (await menuItem(page, 'Reopen')).click();
  await expectReopened(app, page);
});

test("Reopen's Undo finishes the session again: claude is asked to leave, and once it has gone the session is finished and its tab closed", async ({ app, page }) => {
  await app.boot(finishedView);
  await reopenButton(page).click();
  await expectReopened(app, page);
  await toastButton(page, 'Undo').click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  await app.emit('onTerminalExit', FIRST, 0);
  await expect.poll(() => app.calls('finish')).toEqual([[[done.id]]]);
  await expect(tab(page, done.title)).toHaveCount(0);
  await expect(row(page, done.title)).toBeVisible();
});

test("Reopen's Undo pressed while claude is still starting waits for the start, then finishes the session", async ({ app, page }) => {
  await app.boot(finishedView);
  await app.hold('startTerminal');
  await reopenButton(page).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await toastButton(page, 'Undo').click();
  expect(await app.calls('closeTerminal')).toEqual([]);
  expect(await app.calls('finish')).toEqual([]);
  await app.release('startTerminal');
  await expect.poll(() => app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  await app.emit('onTerminalExit', FIRST, 0);
  await expect.poll(() => app.calls('finish')).toEqual([[[done.id]]]);
  await expect(tab(page, done.title)).toHaveCount(0);
});

test('Reopen on a session whose folder is gone says why, and unfinishes nothing', async ({ app, page }) => {
  const GONE = `${HOME}/projects/gone`;
  const gone = { ...done, cwd: GONE, repoRoot: GONE, cwdExists: false, repoRootExists: false };
  await app.boot({ ...finishedView, sessions: [gone] });
  await reopenButton(page).click();
  await expect(page.locator('#toast-message')).toHaveText(unstartableReason(gone)!);
  expect(await app.calls('unfinish')).toEqual([]);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('a press on a finished row opens nothing', async ({ app, page }) => {
  await app.boot(finishedView);
  await row(page, done.title).locator('.card-title').click();
  await expect(tab(page, done.title)).toHaveCount(0);
  expect(await app.calls('unfinish')).toEqual([]);
  expect(await app.calls('startTerminal')).toEqual([]);
});
