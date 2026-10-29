import { settingsFileWith } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { bootList } from './list';

// A run that fails under a good list leaves the list on show under a line saying when each ran, in the language of the settings.
const LIST = { version: 1, sections: [{ items: [{ key: 'a', text: 'README.md' }] }] };

test("the failed run's line says its times in the language of the settings, following a change of it at once", async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await bootList(app, page, LIST);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  const { token } = (await runs(app, 'changes'))[1];
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 1, signal: null });
  const line = page.locator('.list-failed');
  // The checks' browser reads its system as en-US.
  await expect(line).toHaveText('The run at 03:30 PM failed: the script exited with 1. This is the list from 03:30 PM.');

  await app.settingsOnDisk(settingsFileWith('settings.json', { locale: 'en-GB' }));
  await expect(line).toHaveText('The run at 15:30 failed: the script exited with 1. This is the list from 15:30.');
});
