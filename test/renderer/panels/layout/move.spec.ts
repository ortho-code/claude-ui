import { expect, test } from '../../support/harness';
import { localLayoutWith, noLocalLayout } from '../../support/fixture';
import { LAYOUT, withLayout, withLegacyState } from './layout';

// The tree's state as `meta.json` kept it before the config folder moves into the app's file beside the layout on the first read, once, worked out against the tree (docs/architecture.md § Panel state).
const notMoved = { ...noLocalLayout(), stateMoved: false };

test('the sizes, folds and picks meta.json kept move into the app’s file on the first read, and the window looks as it did', async ({ app, page }) => {
  const fixture = withLayout(LAYOUT);
  await app.boot({
    ...fixture,
    layout: { ...fixture.layout, local: notMoved },
    ...withLegacyState({ sizes: { window: { sidebar: 280, main: 900, right: 360 } }, collapsed: ['right'], active: { right: 'checks' } }),
  });
  // The sidebar's dragged px become its pixels; the middle column, the one flexible child, takes what is left; the right column's px are what the file says, so they are not written.
  await expect.poll(() => app.calls('moveLayoutState')).toEqual([[{ sidebar: { size: '280px' }, right: { folded: true, active: 'checks' } }]]);
  await expect.poll(async () => Math.round((await page.locator('#sidebar').boundingBox())!.width)).toBe(280);
  await expect(page.getByRole('button', { name: 'Unfold right' })).toBeVisible();
});

test('the sidebar’s width from before it was a node moves too, into the default layout', async ({ app, page }) => {
  await app.boot({ layout: { ...withLayout(null).layout, status: 'missing', local: notMoved }, uiState: { ...withLegacyState({}).uiState, sidebarWidth: 300 } });
  await expect.poll(() => app.calls('moveLayoutState')).toEqual([[{ sidebar: { size: '300px' } }]]);
  await expect.poll(async () => Math.round((await page.locator('#sidebar').boundingBox())!.width)).toBe(300);
});

test('nothing moves over an app’s file that already holds something, and what it holds is shown', async ({ app, page }) => {
  const fixture = withLayout(LAYOUT);
  await app.boot({ ...fixture, layout: { ...fixture.layout, local: { ...localLayoutWith({ sidebar: { size: '250px' } }), stateMoved: false } }, ...withLegacyState({ sizes: { window: { sidebar: 280, main: 900, right: 360 } } }) });
  await expect.poll(async () => Math.round((await page.locator('#sidebar').boundingBox())!.width)).toBe(250);
  // Asked all the same, so main records the move as made; it writes nothing over a file that holds nodes.
  await expect.poll(() => app.calls('moveLayoutState')).toHaveLength(1);
});

test('once moved, nothing is moved again', async ({ app }) => {
  await app.boot({ ...withLayout(LAYOUT), ...withLegacyState({ collapsed: ['right'] }) });
  await expect.poll(() => app.calls('getLayout')).toHaveLength(1);
  expect(await app.calls('moveLayoutState')).toEqual([]);
});
