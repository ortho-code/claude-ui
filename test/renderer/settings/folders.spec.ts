import { expect, test } from '../support/harness';
import { openSettings } from '../support/settings';

test('Settings lists each of the app folders once, the config folder in General and the logs in Logs, and each Open names its own folder', async ({ app, page }) => {
  await app.boot({ folders: { config: '/home/tester/.config/claude-ui/config', logs: '/home/tester/.config/claude-ui/logs' } });
  const dialog = await openSettings(page, 'General');
  const config = dialog.locator('#settings-folder-config .dialog-group');
  const logs = dialog.locator('#settings-folder-logs .dialog-group');

  await expect(config).toHaveCount(1);
  await expect(config).toContainText('Config folder');
  await expect(config.locator('.dialog-path')).toHaveText('/home/tester/.config/claude-ui/config');
  await config.getByRole('button', { name: 'Open' }).click();

  await dialog.getByRole('tab', { name: 'Logs' }).click();
  await expect(logs).toHaveCount(1);
  await expect(logs).toContainText('Logs');
  await expect(logs.locator('.dialog-path')).toHaveText('/home/tester/.config/claude-ui/logs');
  await logs.getByRole('button', { name: 'Open' }).click();
  // By name, never by path: main alone knows the paths, so nothing the window sends is ever opened as one.
  expect(await app.calls('openFolder')).toEqual([['config'], ['logs']]);

  // The rows are built afresh each time Settings opens, so opening it again must not add a second set.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await openSettings(page, 'Logs');
  await expect(logs).toHaveCount(1);
  await expect(config).toHaveCount(1);
});
