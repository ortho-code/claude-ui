import type { Page } from '@playwright/test';
import { expect, test, type App } from '../../../support/harness';
import { pixels, type Rgb } from '../../../support/looks';
import { newTerminal, panelTabLabels } from '../../../support/window';
import { withLayout } from '../../layout/layout';

// A shell's scrollbar is the app's own thin one (base.css), drawn in the gutter xterm's viewport keeps at its right edge, which the terminal is fitted to stay clear of (docs/architecture.md § Traps worth knowing).
// Chromium draws scrollbars in these checks only, since a headless run otherwise hides them and leaves no gutter at all.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

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

/** Boot, make the panel's first shell (terminal 1), and write it more lines than it shows, so it has scrollback to scroll through. */
async function bootWithScrollback(app: App, page: Page): Promise<void> {
  await app.boot(layout);
  await newTerminal(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\r\n'))).toBe(1);
  // xterm sizes what there is to scroll on a render frame, after the write is parsed, so this waits for that rather than for the write.
  await expect.poll(() => page.locator('.panel-terminal:visible .xterm-viewport').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
}

/** The middle column of the shell's scrollbar gutter, top to bottom, as drawn. */
async function gutter(page: Page): Promise<Rgb[]> {
  const viewport = page.locator('.panel-terminal:visible .xterm-viewport');
  const clip = await viewport.evaluate((el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return { x: box.left + el.clientWidth, y: box.top, width: el.offsetWidth - el.clientWidth, height: el.clientHeight };
  });
  expect(clip.width, 'Chromium leaves a gutter for the bar').toBeGreaterThan(0);
  return (await pixels(page, clip)).map((row) => row[Math.floor(clip.width / 2)]);
}

test('a shell with more lines than it shows has its scrollbar in sight, and its last line inside the panel', async ({ app, page }) => {
  await bootWithScrollback(app, page);
  // The thumb is drawn in a colour of its own over the track, which shows the terminal's background: a gutter of one colour is one the terminal paints over.
  expect(new Set((await gutter(page)).map(String)).size).toBeGreaterThan(1);
  const { screenBottom, contentBottom } = await page.locator('.panel-terminal:visible').evaluate((box) => ({
    screenBottom: box.querySelector('.xterm-screen')!.getBoundingClientRect().bottom,
    contentBottom: box.getBoundingClientRect().bottom - parseFloat(getComputedStyle(box).paddingBottom),
  }));
  expect(screenBottom).toBeLessThanOrEqual(contentBottom);
});
