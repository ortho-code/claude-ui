import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { railItem, withLayout } from '../../layout/layout';

// A shell panel starts in the folder you are working in (docs/architecture.md § The `terminal` type), and main refuses one whose folder is not there: the panel says so in its header, and its icon fails, so a shut group says it too.
const layout = withLayout({
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
          { id: 'shell', type: 'terminal', title: 'Shell' },
          { id: 'status', type: 'command', title: 'Status', options: { command: 'git status --short' } },
        ],
      },
    ],
  },
});

test('a shell whose folder is gone is refused: its header says the folder is not there, and its icon fails', async ({ app, page }) => {
  await app.boot({ ...layout, paths: { [PROJECT]: 'missing' } });
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  await expect(page.locator('.panel-end', { hasText: `${PROJECT} is not there` })).toBeVisible();
  await expect(railItem(page, /^Shell/).locator('.nudge.failed')).toBeVisible();
});
