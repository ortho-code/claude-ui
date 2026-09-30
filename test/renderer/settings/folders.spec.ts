import { expect, test } from '../support/harness';

test('Settings lists each of the app folders once, and each Open names its own folder', async ({ app, page }) => {
  await app.boot({ folders: { config: '/home/tester/.config/claude-ui/config', logs: '/home/tester/.config/claude-ui/logs' } });
  const toggle = page.getByRole('button', { name: 'Settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const rows = dialog.locator('#settings-folders .dialog-section');

  await toggle.click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Config folder');
  await expect(rows.nth(0).locator('.dialog-path')).toHaveText('/home/tester/.config/claude-ui/config');
  await expect(rows.nth(1)).toContainText('Logs');
  await expect(rows.nth(1).locator('.dialog-path')).toHaveText('/home/tester/.config/claude-ui/logs');

  await rows.nth(0).getByRole('button', { name: 'Open' }).click();
  await rows.nth(1).getByRole('button', { name: 'Open' }).click();
  // By name, never by path: main alone knows the paths, so nothing the window sends is ever opened as one.
  expect(await app.calls('openFolder')).toEqual([['config'], ['logs']]);

  // The rows are built afresh each time Settings opens, so opening it again must not add a second set.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await toggle.click();
  await expect(rows).toHaveCount(2);
});
