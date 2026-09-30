import type { Page } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { LAYOUT, here, withLayout } from '../../layout/layout';

// The terminal area is one instance for the run (docs/architecture.md § Panels): a layout change that remounts its entry — a new id, an option — puts back the very same pane, so a running session and its terminal go on as they were.
// The layout's drawer starts its shell first, so the claude is the second terminal.
const CLAUDE = 2;

/** Mark the pane and the tab's terminal, so the same elements can be told from rebuilt ones afterwards. */
const markElements = (page: Page): Promise<void> =>
  page.evaluate(() => {
    for (const el of [document.getElementById('terminal-pane'), document.querySelector('#terminals .term.active')]) (el as HTMLElement).dataset.marked = 'yes';
  });
/** Whether the pane and the terminal on screen — in the window, not parked — are the marked ones. */
const stillMarked = (page: Page): Promise<boolean[]> =>
  page.evaluate(() => [
    document.querySelector<HTMLElement>('#app #terminal-pane')?.dataset.marked === 'yes',
    document.querySelector<HTMLElement>('#app #terminals .term.active')?.dataset.marked === 'yes',
  ]);

test('a new id or an option for the terminal area keeps a running session and its terminal as they were', async ({ app, page }) => {
  await app.boot({ ...withLayout(LAYOUT), openSessions: [here.id], activeSession: here.id, history: { [here.id]: [] } });
  await page.locator('.tab-label', { hasText: here.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', CLAUDE, 'claude is here')).toBe(1);
  await expect(page.locator('#term-placeholder')).toBeHidden();
  await markElements(page);

  const edited = structuredClone(LAYOUT);
  const main = edited.root.columns[1] as { rows: { panels: { id: string; type: string; options?: object }[] }[] };
  main.rows[0].panels[0] = { id: 'terminal', type: 'claude' };
  expect(await app.emit('onLayoutChanged', withLayout(edited).layout)).toBe(1);
  await expect(page.locator('.tab', { hasText: here.title })).not.toHaveClass(/\bcold\b/);
  expect(await stillMarked(page)).toEqual([true, true]);

  main.rows[0].panels[0] = { id: 'terminal', type: 'claude', options: { tabs: false } };
  expect(await app.emit('onLayoutChanged', withLayout(edited).layout)).toBe(1);
  await expect(page.locator('.tab', { hasText: here.title })).not.toHaveClass(/\bcold\b/);
  expect(await stillMarked(page)).toEqual([true, true]);

  // Nothing was started again, and nothing ended.
  expect(await app.calls('startTerminal')).toHaveLength(1);
  expect([...(await app.calls('killTerminal')), ...(await app.calls('closeTerminal'))]).toEqual([]);
  await expect(page.locator('#term-placeholder')).toBeHidden();
});
