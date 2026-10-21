import type { Page } from '@playwright/test';

/**
 * When claude's exit comes, set by the check rather than by how fast the machine runs.
 * Unless a stop was asked for, the window reads an exit within a moment of the start as a failed start and keeps the tab, and a later one as claude ending by itself and closes it (`onTabExit`, src/renderer/panels/types/claude/terminals.ts).
 * With the real clock, a loaded machine ran past that moment between a check's start and its exit, and the tab closed as if claude had ended by itself (seen with 24 workers, 2026-10-21).
 */

/** Hold the window's clock still from here on, so claude's exit comes in the moment of its start and reads as a failed start, however slow the run. */
export async function exitAtOnce(page: Page): Promise<void> {
  await page.clock.setFixedTime(Date.now());
}

/** Move the window's clock a minute on, well past that moment, so claude's exit from here on reads as claude ending by itself. */
export async function exitLater(page: Page): Promise<void> {
  await page.clock.setSystemTime(Date.now() + 60_000);
}
