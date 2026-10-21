import type { Page } from '@playwright/test';

/**
 * Hold the window's clock still from here on, so claude's exit comes in the moment of its start and reads as a failed start, however slow the run.
 * The window reads an exit within a moment of the start as a failed start (`onTabExit`, src/renderer/panels/types/claude/terminals.ts); with the real clock, a loaded machine ran past that moment between a check's start and its exit, and the tab closed as if claude had ended by itself (seen with 24 workers, 2026-10-21).
 */
export async function exitAtOnce(page: Page): Promise<void> {
  await page.clock.setFixedTime(Date.now());
}
