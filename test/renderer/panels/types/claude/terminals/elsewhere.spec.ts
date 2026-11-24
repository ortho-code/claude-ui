import type { Locator, Page } from '@playwright/test';
import type { RunningElsewhere, TerminalLaunch } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab } from '../../../../support/window';

// A session another claude runs already is not resumed in a tab, since both would write their own copy of its transcript (docs/architecture/claude.md § A session another claude runs): the tab stays cold, says where the session runs, and offers a copy of it or the start regardless.
const one = session();
const ELSEWHERE: RunningElsewhere = { where: 'terminal', cwd: '/work/scienta', since: Date.UTC(2026, 10, 23, 13, 35) };
const fixture = { sessions: [one], history: { [one.id]: [] }, elsewhere: { [one.id]: ELSEWHERE } };

/** Every claude the window asked main to start: the folder, and how. */
const launches = async (app: App): Promise<[string, TerminalLaunch][]> => (await app.calls('startTerminal')) as [string, TerminalLaunch][];

const pane = (page: Page): Locator => page.locator('#term-placeholder');
const button = (page: Page, label: string): Locator => pane(page).locator('button', { hasText: label });

test('a session another claude runs is not resumed, and its tab says where it runs, offering a copy or the start regardless', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect(pane(page)).toContainText(`“${one.title}” is already running in a terminal in /work/scienta, which started `);
  await expect(pane(page)).toContainText('Starting it here too would split its transcript in two.');
  await expect(pane(page).locator('button')).toHaveText(['Start a copy', 'Start anyway', 'Show history']);
  expect(await launches(app)).toEqual([[PROJECT, expect.objectContaining({ resumeSessionId: one.id })]]);
});

test('Start anyway resumes it here as well', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await button(page, 'Start anyway').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const [, [cwd, launch]] = await launches(app);
  expect(cwd).toBe(PROJECT);
  expect(launch).toMatchObject({ resumeSessionId: one.id, despiteElsewhere: true });
  await expect(pane(page)).toHaveText(`Starting “${one.title}”…`);
});

test('Start a copy forks it into a new session, which starts though the session runs elsewhere', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await button(page, 'Start a copy').click();
  await page.locator('#rename-input').fill('The copy');
  await page.locator('#rename-ok').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const [, [, launch]] = await launches(app);
  expect(launch).toMatchObject({ resumeSessionId: one.id, fork: true, name: 'The copy' });
  await expect(tab(page, 'The copy')).toHaveClass(/\bactive\b/);
});

test('once the other claude has ended, the tab resumes the session as any cold tab does', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect(button(page, 'Start anyway')).toBeVisible();
  await page.evaluate((id) => {
    delete window.__claudeUiFixture.elsewhere[id];
  }, one.id);
  await tab(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const [, [, launch]] = await launches(app);
  expect(launch.resumeSessionId).toBe(one.id);
  expect(launch.despiteElsewhere).toBeUndefined();
  await expect(pane(page)).toHaveText(`Starting “${one.title}”…`);
});
