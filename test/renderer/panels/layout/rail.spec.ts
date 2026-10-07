import { PROJECT } from '../../support/fixture';
import { expect, test } from '../../support/harness';
import { keptChanges, LAYOUT, railItem, runs, there, withLayout } from './layout';

test('the rail shows one panel of a group at a time and runs only the one on show, once', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  expect(await runs(app, 'checks')).toEqual([]);
  expect((await runs(app, 'status'))[0].context.cwd).toBe(PROJECT);

  await railItem(page, /^Checks/).click();
  await expect.poll(() => runs(app, 'checks')).toHaveLength(1);
  expect(await runs(app, 'status')).toHaveLength(1);
  await expect.poll(() => keptChanges(app)).toEqual([{ id: 'right', field: 'active', value: 'checks' }]);
});

test('a command that failed keeps its dot on the rail after you switch away from it', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  const { token } = (await runs(app, 'status'))[0];
  expect(await app.emit('onPanelRun', 'status', token, { kind: 'exit', code: 1, signal: null })).toBe(1);
  const status = railItem(page, /^Status/);
  await expect(status.locator('.nudge.failed')).toBeVisible();

  await railItem(page, /^Checks/).click();
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect(status.locator('.nudge.failed')).toBeVisible();
});

test("the folded sidebar's icon carries the waiting dot while a session waits, and loses it when that session moves on", async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { sidebar: { folded: true } }));
  const sessions = railItem(page, /^Sessions/);
  await expect(sessions).toBeVisible();
  await expect(sessions.locator('.nudge.waiting')).toBeHidden();

  // A session in the project that is not on show: the dot is how the folded sidebar says so.
  expect(await app.emit('onSessionStatus', there.id, 'waiting', '')).toBe(1);
  await expect(sessions.locator('.nudge.waiting')).toBeVisible();
  await app.emit('onSessionStatus', there.id, 'idle', '');
  await expect(sessions.locator('.nudge.waiting')).toBeHidden();
});

test("the folded sidebar's waiting dot outlasts a layout change that remounts its entry", async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { sidebar: { folded: true } }));
  const sessions = railItem(page, /^Sessions/);
  expect(await app.emit('onSessionStatus', there.id, 'waiting', '')).toBe(1);
  await expect(sessions.locator('.nudge.waiting')).toBeVisible();

  // A new id is a new entry, mounted afresh with a dot of its own, while nothing it would say has changed.
  await sessions.locator('.nudge').evaluate((dot) => dot.setAttribute('data-before', ''));
  const edited = structuredClone(LAYOUT);
  edited.root.columns[0].panels = [{ id: 'sidebar-panel', type: 'sessions' }];
  // The app's file still holds the fold, as it would on disk; only the layout file was edited.
  expect(await app.emit('onLayoutChanged', withLayout(edited, { sidebar: { folded: true } }).layout)).toBe(1);
  await expect(sessions.locator('.nudge:not([data-before])')).toHaveCount(1);
  await expect(sessions.locator('.nudge.waiting')).toBeVisible();
});
