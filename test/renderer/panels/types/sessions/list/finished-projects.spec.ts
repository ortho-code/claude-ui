import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/config/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { headings, project, projectHeading, row, switcherEntry } from '../../../../support/window';

// A project stays while it has a session that is not being deleted, finished ones included: one whose sessions are all finished stays in the list and the switcher, empty and saying so, until its sessions are deleted (docs/architecture/sessions.md § App-side metadata and session groups).
const OTHER = `${HOME}/projects/other`;
const here = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Over here' });
const alsoHere = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Also here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const fixture = { sessions: [here, alsoHere, there], projectOrder: [PROJECT, OTHER], activeProject: null };
/** `alsoHere` finished already, so finishing `here` leaves the project with none in view. */
const oneLeft = { ...fixture, finished: { [alsoHere.id]: 1 } };

const finish = async (page: Page, title: string): Promise<void> => {
  await row(page, title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Finished' }).click();
};
/** The line under a project's heading that says its sessions are all finished. */
const allFinishedLine = (page: Page, name: string): Locator => project(page, name).locator('> .section-empty');

test('finishing the last session of a project leaves the project in the list and the switcher, empty, saying so', async ({ app, page }) => {
  await app.boot(oneLeft);
  await expect(allFinishedLine(page, 'demo')).toBeHidden();

  await finish(page, here.title);
  await expect(row(page, here.title)).toHaveCount(0);
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(projectHeading(page, 'demo').locator('.heading-count')).toHaveText('0');
  await expect(allFinishedLine(page, 'demo')).toHaveText('All 2 sessions here are finished.');
  // Work can start there again from where it is.
  await expect(projectHeading(page, 'demo').locator('.project-add')).toBeEnabled();

  await page.locator('#switcher-current').click();
  await expect(switcherEntry(page, 'demo').locator('.switcher-item-count')).toHaveText('0');
});

test('folding a project whose sessions are all finished folds its line away with its groups', async ({ app, page }) => {
  await app.boot({ ...fixture, finished: { [here.id]: 1, [alsoHere.id]: 2 } });
  await expect(allFinishedLine(page, 'demo')).toBeVisible();
  await projectHeading(page, 'demo').click();
  await expect(project(page, 'demo')).toHaveClass(/\bcollapsed\b/);
  await expect(allFinishedLine(page, 'demo')).toBeHidden();
});

test('a project whose one session is finished says so in the singular', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [here, there] });
  await finish(page, here.title);
  await expect(allFinishedLine(page, 'demo')).toHaveText('Its only session is finished.');
});

test('finishing the last session of the project on show stays on that project', async ({ app, page }) => {
  await app.boot({ ...oneLeft, activeProject: PROJECT });
  await expect(page.locator('#switcher-name')).toHaveText('demo');

  await finish(page, here.title);
  await expect(allFinishedLine(page, 'demo')).toHaveText('All 2 sessions here are finished.');
  await expect(headings(page)).toHaveText(['demo']);
  await expect(page.locator('#switcher-name')).toHaveText('demo');
  expect(await app.calls('setActiveProject')).toEqual([]);
});

test('a filter leaves out a project whose sessions are all finished, as it does any project with no match', async ({ app, page }) => {
  await app.boot({ ...fixture, finished: { [here.id]: 1, [alsoHere.id]: 2 } });
  await expect(headings(page)).toHaveText(['demo', 'other']);

  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Over');
  await expect(headings(page)).toHaveText(['other']);
  await page.locator('#search').fill('');
  await expect(headings(page)).toHaveText(['demo', 'other']);
});

// The delete itself takes it away, before main has listed anything again: the listing is held, so only the delete in flight can.
test('deleting the last finished session of the project on show takes the project away at once, and falls back to All', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [here, there], finished: { [here.id]: 1 }, activeProject: PROJECT, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, finished: true } } });
  await expect(page.locator('#switcher-name')).toHaveText('demo');
  await expect(row(page, here.title)).toHaveCount(1);

  await app.hold('listSessions');
  await row(page, here.title).locator('.delete-btn').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => app.calls('deleteSession')).toEqual([[here.id]]);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await page.locator('#switcher-current').click();
  await expect(switcherEntry(page, 'demo')).toHaveCount(0);
  await app.release('listSessions');
});

test('deleting the finished sessions of a project takes it away, and the project on show falls back to All', async ({ app, page }) => {
  await app.boot({ ...fixture, finished: { [here.id]: 1, [alsoHere.id]: 2 }, activeProject: PROJECT });
  await expect(page.locator('#switcher-name')).toHaveText('demo');

  // As main would list it next, with the project's transcripts gone to the trash.
  await app.listOnDisk([there]);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['other']);
});
