import type { Locator, Page } from '@playwright/test';
import { PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { row, stripRow, tab, tabLabel } from '../../../support/window';

// A session's menu opens with what the session is, on every surface that has its kebab, so a tab and the strip, which say less than its row, still show its title, place, status, activity, worktree and note.
const full = session({ title: 'Fix the tab drag', worktree: 'feat-drag' });
const fixture = {
  sessions: [full],
  openSessions: [full.id],
  history: { [full.id]: [] },
  notes: { [full.id]: 'Check it on a mac\nand on linux' },
  groupState: { groups: [{ id: 'g-bugs', name: 'Bugs', repoRoot: PROJECT }], groupOf: { [full.id]: 'g-bugs' } },
};

const header = (page: Page): Locator => page.locator('.kebab-menu .menu-header');
const lines = (page: Page): Locator => header(page).locator('.menu-header-line');

for (const [surface, kebab] of [
  ['row', (page: Page) => row(page, full.title).locator('.session-kebab')],
  ['tab', (page: Page) => tab(page, full.title).locator('.tab-kebab')],
  ['strip item', (page: Page) => stripRow(page, full.title).locator('.strip-item-kebab')],
] as const) {
  test(`a session's menu on its ${surface} opens with its title, where it is filed, its status, its activity, its worktree and its note`, async ({ app, page }) => {
    await app.boot(fixture);
    // Started, since running (or a paused tab) is what puts a session in the strip, and then waiting for you.
    await tabLabel(page, full.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
    expect(await app.emit('onSessionStatus', full.id, 'waiting', '', '')).toBe(1);
    const meta = await row(page, full.title).locator('.meta-text').textContent();
    await kebab(page).click();
    await expect(lines(page)).toHaveText([full.title, 'demo · Bugs · Waiting for you', meta!, 'Linked git worktree: feat-drag', 'Check it on a mac']);
    // Outside the archived view, the row's meta line and the header's are one rule.
    expect(meta).toMatch(/ · Opus 5\.5$/);
  });
}

test("a session's menu header is not an item: a click on it leaves the menu up", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, full.title).locator('.session-kebab').click();
  await header(page).click();
  await expect(header(page)).toBeVisible();
});

test("a session whose folder is gone says why in its menu's header", async ({ app, page }) => {
  const gone = session({ title: 'Gone', cwdExists: false, repoRootExists: false });
  await app.boot({ sessions: [gone] });
  const reason = await row(page, gone.title).locator('.card-title').getAttribute('data-tooltip');
  await row(page, gone.title).locator('.session-kebab').click();
  await expect(lines(page).last()).toHaveText(reason!);
});
