import { expect, test } from '../../../support/harness';
import { newTerminal, panelTabLabels } from '../../../support/window';
import { railItem, withLayout } from '../../layout/layout';

// A shell's panel shares its group with another, so the rail takes it out of view and brings it back.
const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      {
        id: 'right',
        size: '420px',
        panels: [
          { id: 'shell', type: 'terminal', title: 'Shell' },
          { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } },
        ],
      },
    ],
  },
});

test("a shell brought back into view has its scrollbar where its lines are", async ({ app, page }) => {
  await app.boot(layout);
  await newTerminal(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\r\n'))).toBe(1);
  const viewport = page.locator('.panel-terminal .xterm-viewport');
  await expect.poll(() => viewport.evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);

  await railItem(page, /^Status/).click();
  await expect(viewport).toBeHidden();
  await railItem(page, /^Shell/).click();
  await expect(viewport).toBeVisible();

  // Nothing scrolled it, so it is still at its last line, and so is its bar: the terminal draws on a canvas, which the page cannot read.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await viewport.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1), 'the scrollbar is at the bottom').toBe(true);
});

test('a shell scrolled up comes back into view at the same place, its scrollbar with it', async ({ app, page }) => {
  await app.boot(layout);
  await newTerminal(page).click();
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\r\n'))).toBe(1);
  const viewport = page.locator('.panel-terminal .xterm-viewport');
  await expect.poll(() => viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Halfway up, as a wheel would leave it; xterm follows the bar on its scroll event.
  await viewport.evaluate((el) => (el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2)));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const before = await viewport.evaluate((el) => el.scrollTop);

  await railItem(page, /^Status/).click();
  await expect(viewport).toBeHidden();
  await railItem(page, /^Shell/).click();
  await expect(viewport).toBeVisible();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await viewport.evaluate((el) => el.scrollTop)).toBe(before);
});
