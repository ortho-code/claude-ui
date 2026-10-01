import type { Page } from '@playwright/test';
import { type App, expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';
import { here, railItem, withLayout } from '../../../layout/layout';

// The tab on show fills the terminal area, and claude is told its size in columns and rows, whenever the area changes size: the window, a divider, the layout rebuilt.
// An area with no size is out of sight — behind another panel of its group, or folded — and is left alone until it has one, since a fit then would size claude to nothing it can draw in (docs/architecture.md, the hidden-pane trap).
const fixture = { history: { [here.id]: [] } };
// The terminal area sharing a group with a command, so that showing the command puts it out of sight.
const shared = {
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      {
        id: 'main',
        panels: [
          { id: 'cli', type: 'claude' },
          { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } },
        ],
      },
    ],
  },
};

type Size = [id: number, cols: number, rows: number];
const sizes = async (app: App): Promise<Size[]> => (await app.calls('resizeTerminal')) as Size[];
const lastSize = async (app: App): Promise<Size> => (await sizes(app)).at(-1)!;

/** Start the session's row and let claude print, so the tab on show is live; the stand-in numbers its ptys from 1. */
async function goLive(page: Page, app: App): Promise<void> {
  await row(page, here.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, 'claude is here')).toBe(1);
  await expect(page.locator('#term-placeholder')).toBeHidden();
  await expect.poll(() => sizes(app)).not.toEqual([]);
}

/** Two frames, by which a resize has been observed and answered. */
const settle = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

test('the tab on show is fitted to the terminal area as it grows, and claude is told the new size', async ({ app, page }) => {
  await app.boot({ ...withLayout(shared), ...fixture });
  await goLive(page, app);
  const [, cols, rows] = await lastSize(app);

  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect.poll(async () => (await lastSize(app))[1]).toBeGreaterThan(cols);
  expect((await lastSize(app))[2]).toBeGreaterThan(rows);
  expect((await lastSize(app))[0]).toBe(1);
});

test('the terminal area out of sight is not fitted, and is fitted to its size again when it comes back', async ({ app, page }) => {
  await app.boot({ ...withLayout(shared), ...fixture });
  await goLive(page, app);
  const [, cols] = await lastSize(app);

  await railItem(page, /^Status/).click();
  await expect(page.locator('#terminals')).toBeHidden();
  await settle(page);
  const sent = (await sizes(app)).length;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await settle(page);
  expect(await sizes(app)).toHaveLength(sent);

  await railItem(page, /^Claude/).click();
  await expect(page.locator('#terminals')).toBeVisible();
  await expect.poll(async () => (await lastSize(app))[1]).toBeGreaterThan(cols);
});
