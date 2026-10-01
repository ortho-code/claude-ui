import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { row } from '../../../support/window';
import { here, railItem, there, withLayout } from '../../layout/layout';

// The terminal area's icon on the rail says a tab on show is waiting for you, while it is behind another panel of its group or folded: a tab in the project on show, or any in All, and not once you have marked it read.
const shared = {
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      {
        id: 'main',
        panels: [
          { id: 'cli', type: 'claude' },
          { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } },
        ],
      },
    ],
  },
};
const fixture = { ...withLayout(shared), activeProject: PROJECT, openSessions: [here.id, there.id], activeSession: here.id, history: { [here.id]: [], [there.id]: [] } };

test("the terminal area's rail icon waits while a tab on show waits for you, and not for a tab elsewhere or one marked read", async ({ app, page }) => {
  await app.boot(fixture);
  await railItem(page, /^Status/).click();
  const dot = railItem(page, /^Claude/).locator('.nudge.waiting');
  await expect(railItem(page, /^Claude/)).toBeVisible();
  await expect(dot).toBeHidden();

  // A tab in another project is not on show here.
  expect(await app.emit('onSessionStatus', there.id, 'waiting', '')).toBe(1);
  await expect(row(page, there.title)).toHaveCount(0);
  await expect(dot).toBeHidden();

  expect(await app.emit('onSessionStatus', here.id, 'waiting', '')).toBe(1);
  await expect(dot).toBeVisible();
  // Marked read from its row.
  await row(page, here.title).locator('.nudge').click();
  await expect(dot).toBeHidden();

  // In All, the other project's tab is on show too.
  await page.locator('#switcher-current').click();
  await page.locator('.switcher-item', { has: page.locator('.switcher-item-name', { hasText: /^All$/ }) }).click();
  await expect(row(page, there.title)).toHaveCount(1);
  await expect(dot).toBeVisible();
});

test("the terminal area's waiting dot outlasts a layout change that remounts its entry", async ({ app, page }) => {
  await app.boot(fixture);
  await railItem(page, /^Status/).click();
  const claude = railItem(page, /^Claude/);
  expect(await app.emit('onSessionStatus', here.id, 'waiting', '')).toBe(1);
  await expect(claude.locator('.nudge.waiting')).toBeVisible();

  // A new id is a new entry, mounted afresh with a dot of its own, while nothing it would say has changed.
  await claude.locator('.nudge').evaluate((dot) => dot.setAttribute('data-before', ''));
  const edited = structuredClone(shared);
  edited.root.columns[1].panels[0] = { id: 'terminal', type: 'claude' };
  expect(await app.emit('onLayoutChanged', withLayout(edited).layout)).toBe(1);
  await expect(claude.locator('.nudge:not([data-before])')).toHaveCount(1);
  await expect(claude.locator('.nudge.waiting')).toBeVisible();
});
