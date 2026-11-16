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
  // The checks' browser runs in nl-NL (playwright.config.ts).
  await expect(line).toHaveText('The run at 15:30 failed: the script exited with 1. This is the list from 15:30.');

  await app.settingsOnDisk(settingsFileWith('settings.json', { locale: 'en-US' }));
  await expect(line).toHaveText('The run at 03:30 PM failed: the script exited with 1. This is the list from 03:30 PM.');
});

// What the script wrote on stderr is what it has to say about why it failed, so it is on the page, folded under the line, not on a hover alone.
test("the failed run's line unfolds what the script wrote on stderr, folded at first, and has no tooltip", async ({ app, page }) => {
  await bootList(app, page, LIST);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  const { token } = (await runs(app, 'changes'))[1];
  await app.emit('onPanelRun', 'changes', token, { kind: 'stderr', text: 'gh: HTTP 401: Bad credentials\nTry authenticating with: gh auth login\n' });
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 1, signal: null });
  const line = page.locator('.list-failed');
  const output = line.locator('.list-failed-output');
  await expect(line).toBeVisible();
  await expect(output).toBeHidden();
  await expect(line.locator('[data-tooltip]')).toHaveCount(0);
  await expect(line).not.toHaveAttribute('data-tooltip');

  await line.locator('summary').click();
  await expect(output).toBeVisible();
  await expect(output).toHaveText('gh: HTTP 401: Bad credentials\nTry authenticating with: gh auth login');
  // The list stays on show under it.
  await expect(page.locator('.list-row', { hasText: 'README.md' })).toBeVisible();
});

test("a failed run with nothing on stderr has a line with nothing to unfold", async ({ app, page }) => {
  await bootList(app, page, LIST);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  const { token } = (await runs(app, 'changes'))[1];
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 1, signal: null });
  const line = page.locator('.list-failed');
  await expect(line).toHaveClass(/\bbare\b/);
  await line.locator('summary').click();
  await expect(line).not.toHaveAttribute('open');
});
