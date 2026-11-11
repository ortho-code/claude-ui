import type { Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { goLive } from '../../../../support/live';
import { type App, expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// A link claude breaks over several rows, as it sends one with hyperlinks on: each row's piece is the same OSC 8 link, so any piece stands for the whole address.
const one = session();
const fixture = { history: { [one.id]: [] } };
const FIRST = 1;
const ADDRESS = 'https://example.com/a/very/long/path/that/claude/broke/over/two/rows/index.html';
const piece = (text: string): string => `\x1b]8;id=l1;${ADDRESS}\x07${text}\x1b]8;;\x07`;
// The screen cleared first, so the link's pieces sit on its first two rows.
const BROKEN_LINK = `\x1b[2J\x1b[H${piece('https://example.com/a/very/long/path/')}\r\n${piece('that/claude/broke/over/two/rows/index.html')}`;

/** Show the broken link in a live tab, and point the mouse at its second row's piece. */
async function pointAtSecondRow(page: Page, app: App): Promise<void> {
  await app.boot(fixture);
  await goLive(page, app, row(page, one.title));
  expect(await app.emit('onTerminalData', FIRST, BROKEN_LINK)).toBe(1);
  // The rows are drawn on a canvas, so the second one is found by xterm's input box, which sits on the cursor's cell: the end of the second piece.
  const screen = page.locator('.term:visible .xterm-screen');
  const cursor = page.locator('.term:visible .xterm-helper-textarea');
  await expect.poll(async () => ((await cursor.boundingBox())?.y ?? 0) > ((await screen.boundingBox())?.y ?? 0)).toBe(true);
  const left = (await screen.boundingBox())!.x;
  const cell = (await cursor.boundingBox())!;
  await page.mouse.move(left + cell.width * 5, cell.y + cell.height / 2);
}

test('a press on the second row of a link claude broke over two rows opens the whole address', async ({ app, page }) => {
  await pointAtSecondRow(page, app);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => app.calls('openExternal')).toEqual([[ADDRESS]]);
});

test('hovering a piece of a link claude sent shows the whole address it opens', async ({ app, page }) => {
  await pointAtSecondRow(page, app);
  await expect(page.locator('#tooltip')).toBeVisible();
  await expect(page.locator('#tooltip')).toHaveText(ADDRESS);
  await page.mouse.move(0, 0);
  await expect(page.locator('#tooltip')).toBeHidden();
});
