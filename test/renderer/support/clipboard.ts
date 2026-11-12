import type { Locator, Page } from '@playwright/test';

/**
 * Let the page read and write the clipboard, which Electron allows the app and a headless page does not.
 * Called by every helper here rather than by each check, and by a check before the app itself copies.
 */
export async function allowClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
}

/** Put `text` on the clipboard, as a copy elsewhere would, for a check that pastes it. */
export async function copyText(page: Page, text: string): Promise<void> {
  await allowClipboard(page);
  await page.evaluate((copied) => navigator.clipboard.writeText(copied), text);
}

/** Select a terminal's whole first row with the mouse, as a drag across it does. */
export async function selectFirstRow(page: Page, terminal: Locator): Promise<void> {
  const screen = await terminal.locator('.xterm-screen').boundingBox();
  if (!screen) throw new Error('the terminal has no screen on show');
  const y = screen.y + 4;
  await page.mouse.move(screen.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(screen.x + screen.width - 1, y, { steps: 5 });
  await page.mouse.up();
}

/** The text on the clipboard, for a check that copies. */
export async function clipboardText(page: Page): Promise<string> {
  await allowClipboard(page);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Put an image on the clipboard, and nothing else, as a screenshot does. */
export async function copyImage(page: Page): Promise<void> {
  await allowClipboard(page);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no PNG from the canvas'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
}
