import type { Page } from '@playwright/test';

/**
 * Put `text` on the clipboard, as a copy elsewhere would, for a check that pastes it.
 * Granted here rather than by each check, since a page may not touch the clipboard without both permissions.
 */
export async function copyText(page: Page, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((copied) => navigator.clipboard.writeText(copied), text);
}

/** Put an image on the clipboard, and nothing else, as a screenshot does. */
export async function copyImage(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no PNG from the canvas'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
}
