import type { Page } from '@playwright/test';
import { copyImage, copyText } from '../../../support/clipboard';
import { type App, expect, test } from '../../../support/harness';
import { newTerminal, panelTabLabels } from '../../../support/window';
import { withLayout } from '../../layout/layout';

// A panel's shell takes Ctrl+V as a session's tab does, since both are the one xterm (docs/architecture.md § The `terminal` type).
const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '420px', panels: [{ id: 'shell', type: 'terminal', title: 'Shell' }] },
    ],
  },
});
const LINK = 'https://example.com/a/link';

/** Boot with main saying whether this is WSL, and what it finds copied in Windows, make the panel's first shell (terminal 1), and give it the keyboard. */
async function bootWithShell(app: App, page: Page, wsl: boolean, copiedFiles: string[] = []): Promise<void> {
  await app.boot({ ...layout, wsl, copiedFiles });
  await newTerminal(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  await page.locator('.panel-terminal:visible').click();
  await expect(page.locator('.panel-terminal:visible textarea')).toBeFocused();
}

test('on WSL, Ctrl+V in a shell pastes the text on the clipboard', async ({ app, page }) => {
  await bootWithShell(app, page, true);
  await copyText(page, LINK);
  await page.keyboard.press('Control+V');
  await expect.poll(() => app.calls('sendTerminalInput')).toEqual([[1, LINK]]);
});

test('on WSL, Ctrl+V in a shell with a file copied in Explorer pastes its path, escaped as the shell reads it', async ({ app, page }) => {
  await bootWithShell(app, page, true, ['/mnt/c/Users/me/My Pics/shot.png']);
  await copyImage(page);
  await page.keyboard.press('Control+V');
  await expect.poll(() => app.calls('sendTerminalInput')).toEqual([[1, '/mnt/c/Users/me/My\\ Pics/shot.png']]);
});

test('off WSL, Ctrl+V reaches the shell as the key it is', async ({ app, page }) => {
  await bootWithShell(app, page, false);
  await copyText(page, LINK);
  await page.keyboard.press('Control+V');
  expect(await app.calls('sendTerminalInput')).toEqual([[1, '\x16']]);
});
