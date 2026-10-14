import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { headings, project, projectHeading, row, switcherEntry } from '../../../../support/window';

// A project stays while it has a session that is not being deleted, archived ones included: one whose sessions are all archived stays in the list and the switcher, empty and saying so, until its sessions are deleted (docs/architecture.md § App-side metadata and session groups).
const OTHER = `${HOME}/projects/other`;
const here = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Over here' });
const alsoHere = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Also here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const fixture = { sessions: [here, alsoHere, there], projectOrder: [PROJECT, OTHER], activeProject: null };
/** `alsoHere` archived already, so archiving `here` leaves the project with none in view. */
const oneLeft = { ...fixture, archived: { [alsoHere.id]: 1 } };

const archive = async (page: Page, title: string): Promise<void> => {
  await row(page, title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Archive' }).click();
};
/** The line under a project's heading that says its sessions are all archived. */
const archivedLine = (page: Page, name: string): Locator => project(page, name).locator('> .section-empty');

test('archiving the last session of a project leaves the project in the list and the switcher, empty, saying so', async ({ app, page }) => {
  await app.boot(oneLeft);
  await expect(archivedLine(page, 'demo')).toBeHidden();

  await archive(page, here.title);
  await expect(row(page, here.title)).toHaveCount(0);
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(projectHeading(page, 'demo').locator('.heading-count')).toHaveText('0');
  await expect(archivedLine(page, 'demo')).toHaveText('All 2 sessions here are archived.');
  // Work can start there again from where it is.
  await expect(projectHeading(page, 'demo').locator('.project-add')).toBeEnabled();

  await page.locator('#switcher-current').click();
  await expect(switcherEntry(page, 'demo').locator('.switcher-item-count')).toHaveText('0');
});

test('folding a project whose sessions are all archived folds its line away with its groups', async ({ app, page }) => {
  await app.boot({ ...fixture, archived: { [here.id]: 1, [alsoHere.id]: 2 } });
  await expect(archivedLine(page, 'demo')).toBeVisible();
  await projectHeading(page, 'demo').click();
  await expect(project(page, 'demo')).toHaveClass(/\bcollapsed\b/);
  await expect(archivedLine(page, 'demo')).toBeHidden();
});

test('a project whose one session is archived says so in the singular', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [here, there] });
  await archive(page, here.title);
  await expect(archivedLine(page, 'demo')).toHaveText('Its only session is archived.');
});

test('archiving the last session of the project on show stays on that project', async ({ app, page }) => {
  await app.boot({ ...oneLeft, activeProject: PROJECT });
  await expect(page.locator('#switcher-name')).toHaveText('demo');

  await archive(page, here.title);
  await expect(archivedLine(page, 'demo')).toHaveText('All 2 sessions here are archived.');
  await expect(headings(page)).toHaveText(['demo']);
  await expect(page.locator('#switcher-name')).toHaveText('demo');
  expect(await app.calls('setActiveProject')).toEqual([]);
});

test('a filter leaves out a project whose sessions are all archived, as it does any project with no match', async ({ app, page }) => {
  await app.boot({ ...fixture, archived: { [here.id]: 1, [alsoHere.id]: 2 } });
  await expect(headings(page)).toHaveText(['demo', 'other']);

  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Over');
  await expect(headings(page)).toHaveText(['other']);
  await page.locator('#search').fill('');
  await expect(headings(page)).toHaveText(['demo', 'other']);
});

// The delete itself takes it away, before main has listed anything again: the listing is held, so only the delete in flight can.
test('deleting the last archived session of the project on show takes the project away at once, and falls back to All', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [here, there], archived: { [here.id]: 1 }, activeProject: PROJECT, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, archived: true } } });
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

test('deleting the archived sessions of a project takes it away, and the project on show falls back to All', async ({ app, page }) => {
  await app.boot({ ...fixture, archived: { [here.id]: 1, [alsoHere.id]: 2 }, activeProject: PROJECT });
  await expect(page.locator('#switcher-name')).toHaveText('demo');

  // As main would list it next, with the project's transcripts gone to the trash.
  await app.listOnDisk([there]);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['other']);
});
