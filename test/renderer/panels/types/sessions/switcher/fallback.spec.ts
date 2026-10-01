import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// A project with nothing left to show cannot stay selected: the window falls back to All exactly as picking it does, and every surface that honours the selection follows it there, the tab bar included.
// Setting the scope alone once left the bar empty while the list and the switcher said All, and the pane pointed at a tab above that was not there.
const OTHER = `${HOME}/projects/other`;
const here = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Over here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const fixture = {
  sessions: [here, there],
  projectOrder: [PROJECT, OTHER],
  activeProject: PROJECT,
  openSessions: [here.id, there.id],
  history: { [here.id]: [], [there.id]: [] },
};

const headings = (page: Page): Locator => page.locator('#sessions .project > .section-heading .label');
const tabs = (page: Page): Locator => page.locator('#tabbar .tab-label');

test('archiving the last session of the project on show falls back to All in the list, the switcher and the tab bar', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#switcher-name')).toHaveText('demo');
  await expect(tabs(page)).toHaveText([here.title]);

  await row(page, here.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Archive' }).click();

  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['other']);
  await expect(tabs(page)).toHaveText([there.title]);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a tab above, or a session in the sidebar, to resume it.');
  expect((await app.calls('setActiveProject')).at(-1)).toEqual([null]);
});
