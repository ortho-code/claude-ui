import { PROJECT } from '../../support/fixture';
import { expect, test } from '../../support/harness';
import { LAYOUT, OTHER, railItem, runs, withLayout } from './layout';

test('a change to the layout file keeps a running shell and does not run a command again', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);

  const right = LAYOUT.root.columns[2] as { panels: object[] };
  const edited = structuredClone(LAYOUT);
  (edited.root.columns[2] as typeof right).panels = [...right.panels, { id: 'notes', type: 'command', title: 'Notes', icon: 'book', options: { command: 'cat NOTES' } }];
  expect(await app.emit('onLayoutChanged', withLayout(edited).layout)).toBe(1);
  await expect(railItem(page, /^Notes/)).toBeVisible();

  expect(await app.calls('startShell')).toHaveLength(1);
  expect([...(await app.calls('killTerminal')), ...(await app.calls('closeTerminal'))]).toEqual([]);
  expect(await runs(app, 'status')).toHaveLength(1);
  expect(await runs(app, 'notes')).toEqual([]);
});

test('a hidden command does not run on a project switch, runs once when shown somewhere new, and not at all when shown back where it last ran', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  const folders = async (entry: string): Promise<string[]> => (await runs(app, entry)).map((run) => run.context.cwd);
  const switchTo = async (name: string): Promise<void> => {
    await page.locator('#switcher-current').click();
    await page.locator('.switcher-item', { has: page.locator('.switcher-item-name', { hasText: new RegExp(`^${name}$`) }) }).click();
  };
  await expect.poll(() => folders('status')).toEqual([PROJECT]);
  await railItem(page, /^Checks/).click();
  await expect.poll(() => folders('checks')).toEqual([PROJECT]);

  // Checks on show follows the project; Status behind it stays put.
  await switchTo('other');
  await expect.poll(() => folders('checks')).toEqual([PROJECT, OTHER]);
  await switchTo('demo');
  await expect.poll(() => folders('checks')).toEqual([PROJECT, OTHER, PROJECT]);
  expect(await folders('status')).toEqual([PROJECT]);

  // Shown in the folder it last ran in: nothing to run again.
  await railItem(page, /^Status/).click();
  await expect(railItem(page, /^Status/)).toHaveClass(/\bshown\b/);
  await switchTo('other');
  await expect.poll(() => folders('status')).toEqual([PROJECT, OTHER]);
  // Shown after the project moved while it was hidden: once, in the new folder.
  await railItem(page, /^Checks/).click();
  await expect.poll(() => folders('checks')).toEqual([PROJECT, OTHER, PROJECT, OTHER]);
  expect(await folders('status')).toEqual([PROJECT, OTHER]);
});
