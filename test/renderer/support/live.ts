import type { Locator, Page } from '@playwright/test';
import { type App, expect } from './harness';

/** Press `open`, a session's row or tab, and let its claude print, so the tab on show is live; the stand-in numbers its ptys from 1, and `pty` is the one this start gets. */
export async function goLive(page: Page, app: App, open: Locator, pty = 1): Promise<void> {
  await open.click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(pty);
  expect(await app.emit('onTerminalData', pty, 'claude is here')).toBe(1);
  await expect(page.locator('#term-placeholder')).toBeHidden();
}
