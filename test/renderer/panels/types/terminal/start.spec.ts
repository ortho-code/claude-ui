import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { chooseProject, newTerminal } from '../../../support/window';
import { OTHER, railItem, withLayout } from '../../layout/layout';

// A shell panel starts in the folder you are working in (docs/architecture.md § The `terminal` type), and main refuses one whose folder is not there: the panel says so in its header, and its icon fails, so a shut group says it too.
/** The layout, with `options` for the shell panel where given. */
const layoutWith = (options?: Record<string, unknown>): ReturnType<typeof withLayout> =>
  withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        // Railed, so its icon is on screen; the shell is first, so it is the one shown, and starts.
        {
          id: 'right',
          size: '360px',
          panels: [
            { id: 'shell', type: 'terminal', title: 'Shell', ...(options ? { options } : {}) },
            { id: 'status', type: 'command', title: 'Status', options: { command: 'git status --short' } },
          ],
        },
      ],
    },
  });

const layout = layoutWith();

test('a shell whose folder is gone is refused: its header says the folder is not there, and its icon fails', async ({ app, page }) => {
  await app.boot({ ...layout, paths: { [PROJECT]: 'missing' } });
  await newTerminal(page).click();
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  await expect(page.locator('.panel-end', { hasText: `${PROJECT} is not there` })).toBeVisible();
  await expect(railItem(page, /^Shell/).locator('.nudge.failed')).toBeVisible();
});

// Its options are checked against where you are, so a switch looks again: a panel that cannot run in one project runs in the next, and the other way round.
test('a panel that cannot run in one project looks again on a switch, and runs in a project where it can', async ({ app, page }) => {
  await app.boot({ ...layoutWith({ cwd: 'sub' }), paths: { [`${OTHER}/sub`]: 'directory' } });
  await expect(page.locator('.panel-problems')).toContainText('sub not found');

  await chooseProject(page, 'other');
  await expect(page.locator('.panel-problems')).toHaveCount(0);
  await expect(page.locator('.panel-body .pane-placeholder:visible')).toContainText('No terminal in other.');

  await chooseProject(page, 'demo');
  await expect(page.locator('.panel-problems')).toContainText('sub not found');
});

// Main can answer two looks out of order; the panel goes by the look at where you are now, not one at a project you have left.
test('a look at a project left behind, answered last, does not stand for the one switched back to', async ({ app, page }) => {
  await app.boot({ ...layoutWith({ cwd: 'sub' }), paths: { [`${OTHER}/sub`]: 'directory' } });
  await expect(page.locator('.panel-problems')).toContainText('sub not found');

  const looked = (await app.calls('checkPath')).length;
  await app.hold('checkPath');
  await chooseProject(page, 'other');
  await chooseProject(page, 'demo');
  await expect.poll(async () => (await app.calls('checkPath')).length).toBeGreaterThanOrEqual(looked + 2);
  // The look at demo answers first, then the one at other, which no longer stands.
  await app.release('checkPath', 'last first');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
  await expect(page.locator('.panel-problems')).toContainText('sub not found');
});
