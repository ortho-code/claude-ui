import type { Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { copyImage, copyText } from '../../../../support/clipboard';
import { type App, expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// The keys a tab's terminal takes for itself rather than sending on to claude (docs/architecture.md § The `terminal` type).
const one = session();
const fixture = { history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;
const LINK = 'https://example.com/a/link';

/** Start the session's row and let claude print, with bracketed paste on as claude turns it on, so the tab is live and has the keyboard. */
async function startLive(page: Page, app: App): Promise<void> {
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, '\x1b[?2004hclaude is here')).toBe(1);
  await expect(page.locator('#term-placeholder')).toBeHidden();
}

// Claude reads Ctrl+V as "paste an image", which on WSL asks Windows for an image through powershell.exe before it falls back to text: seconds, the first time.
test('on WSL, Ctrl+V pastes the text on the clipboard rather than sending claude its image key', async ({ app, page }) => {
  await app.boot({ ...fixture, wsl: true });
  await startLive(page, app);
  await copyText(page, LINK);
  await page.keyboard.press('Control+V');
  await expect.poll(() => app.calls('sendTerminalInput')).toEqual([[FIRST, `\x1b[200~${LINK}\x1b[201~`]]);
});

// Claude under WSL reads a paste with nothing in it as an image paste, which is how an image still reaches it on Ctrl+V.
test('on WSL, Ctrl+V with only an image on the clipboard reaches claude as an empty paste', async ({ app, page }) => {
  await app.boot({ ...fixture, wsl: true });
  await startLive(page, app);
  await copyImage(page);
  await page.keyboard.press('Control+V');
  await expect.poll(() => app.calls('sendTerminalInput')).toEqual([[FIRST, '\x1b[200~\x1b[201~']]);
});

test("on WSL, Alt+V still reaches claude, which takes it there as its image key", async ({ app, page }) => {
  await app.boot({ ...fixture, wsl: true });
  await startLive(page, app);
  await page.keyboard.press('Alt+V');
  expect(await app.calls('sendTerminalInput')).toEqual([[FIRST, '\x1bv']]);
});

// On macOS and native Linux, Ctrl+V is claude's only image key, and an empty paste is no image paste on Linux.
test('off WSL, Ctrl+V reaches claude as the key it is', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await copyText(page, LINK);
  await page.keyboard.press('Control+V');
  expect(await app.calls('sendTerminalInput')).toEqual([[FIRST, '\x16']]);
});

test('Ctrl+Enter and Shift+Enter send claude a newline, once each, and no submit', async ({ app, page }) => {
  await app.boot({ ...fixture, wsl: true });
  await startLive(page, app);
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Shift+Enter');
  expect(await app.calls('sendTerminalInput')).toEqual([
    [FIRST, '\n'],
    [FIRST, '\n'],
  ]);
});
