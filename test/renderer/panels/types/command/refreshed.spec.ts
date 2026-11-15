import type { Locator, Page } from '@playwright/test';
import type { Found } from '../../../../../src/shared/helpers/path-check';
import { CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A command panel shows the output of its last run, a failed one's too, so its header's time is that run's.
// The checks' browser runs in nl-NL (playwright.config.ts).
const START = new Date(2026, 9, 29, 15, 30).getTime();
const MINUTE = 60_000;

// A script, so a check can make it go missing and the panel unable to run.
const SCRIPT = `${CONFIG_ROOT}/scripts/status.sh`;

const layout = (): ReturnType<typeof withLayout> & { paths: Record<string, Found> } => ({
  ...withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { script: 'scripts/status.sh' } }] },
      ],
    },
  }),
  paths: { [SCRIPT]: 'executable' },
});

const header = (page: Page): Locator => page.locator('.panel-header', { has: page.locator('.panel-title', { hasText: 'Status' }) });
const refreshed = (page: Page): Locator => header(page).locator('.panel-refreshed');

/** End run `index` of Status with `code`. */
async function end(app: App, index: number, code: number): Promise<void> {
  await expect.poll(() => runs(app, 'status')).toHaveLength(index + 1);
  const { token } = (await runs(app, 'status'))[index];
  await app.emit('onPanelRun', 'status', token, { kind: 'exit', code, signal: null });
}

test("a command panel's header says how long ago its last run ended, a failed one's included, since its output is on show", async ({ app, page }) => {
  await page.clock.install({ time: START });
  await app.boot(layout());
  await expect(refreshed(page)).toBeHidden();
  await end(app, 0, 0);
  await expect(refreshed(page)).toHaveText('just now');
  await expect(refreshed(page)).toHaveAttribute('data-tooltip', 'Refreshed: do 29 okt, 15:30');

  await page.clock.fastForward(3 * MINUTE);
  await header(page).getByRole('button', { name: 'Refresh' }).click();
  await end(app, 1, 1);
  await expect(header(page).locator('.panel-end')).toHaveText('exit 1');
  await expect(refreshed(page)).toHaveText('just now');
  await expect(refreshed(page)).toHaveAttribute('data-tooltip', 'Refreshed: do 29 okt, 15:33');
});

test('a command panel that can no longer run shows no time beside why, since no run made what it shows', async ({ app, page }) => {
  await page.clock.install({ time: START });
  await app.boot(layout());
  await end(app, 0, 0);
  await expect(refreshed(page)).toHaveText('just now');

  await page.evaluate((path) => void (window.__claudeUiFixture.paths[path] = 'missing'), SCRIPT);
  const refresh = header(page).getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await expect(page.locator('.panel-problems')).toBeVisible();
  await expect(refreshed(page)).toBeHidden();
  await expect(refresh).toHaveAttribute('data-tooltip', 'Refresh');
});
