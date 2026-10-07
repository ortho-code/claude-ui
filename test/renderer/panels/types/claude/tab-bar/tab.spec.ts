import type { Locator } from '@playwright/test';
import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { token } from '../../../../support/looks';
import { clickAcross } from '../../../../support/press';
import { tab } from '../../../../support/window';

// What a tab does besides being chosen: its status dot says how its session is, and marks it read; a middle click takes the close button's two steps.
const one = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'The one on show' });
const other = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'The other one' });
const fixture = { sessions: [one, other], openSessions: [one.id, other.id], activeSession: one.id, history: { [one.id]: [], [other.id]: [] } };

test("a tab's dot follows its session's status, and a click on it marks it read without choosing the tab", async ({ app, page }) => {
  await app.boot(fixture);
  const dot = tab(page, other.title).locator('.nudge');
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect(dot).not.toHaveClass(/\bwaiting\b/);

  expect(await app.emit('onSessionStatus', other.id, 'waiting', '', 'Notification')).toBe(1);
  await expect(dot).toHaveClass(/\bwaiting\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);

  // The tab is cold, so a click that reached it would start it as well as choose it.
  await dot.click();
  await expect(dot).toHaveClass(/\backed\b/);
  await dot.click();
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(tab(page, other.title)).not.toHaveClass(/\bactive\b/);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('a tab follows its session as the listing changes on disk: a new title renames it', async ({ app, page }) => {
  await app.boot({ sessions: [one, other], openSessions: [one.id, other.id] });
  await expect(tab(page, other.title)).toHaveCount(1);
  // As claude writing its title into the transcript would leave it, and main listing it again.
  await app.listOnDisk([one, { ...other, title: 'Renamed on disk' }]);
  await expect(tab(page, 'Renamed on disk')).toHaveCount(1);
  await expect(tab(page, other.title)).toHaveCount(0);
});

// The same rule as the row's badge, so a tab and its row never disagree about a worktree.
test("a tab's worktree mark is accent while its session is in the worktree, and muted once the session has left it", async ({ app, page }) => {
  const inside = session({ id: '00000000-0000-4000-8000-0000000000b3', title: 'In its worktree', cwd: `${PROJECT}/.claude/worktrees/feature-x`, worktree: 'feature-x' });
  const left = session({ id: '00000000-0000-4000-8000-0000000000b4', title: 'Left its worktree', leftWorktree: 'feature-y' });
  await app.boot({ sessions: [one, inside, left], openSessions: [one.id, inside.id, left.id] });
  const mark = (title: string): Locator => tab(page, title).locator('.tab-worktree');

  await expect(mark(inside.title)).toHaveAttribute('data-tooltip', 'Linked git worktree: feature-x');
  await expect(mark(inside.title)).toHaveCSS('color', await token(page, '--accent'));
  await expect(mark(left.title)).toHaveAttribute('data-tooltip', `Ran in linked git worktree: feature-y; now back in ${PROJECT}`);
  await expect(mark(left.title)).toHaveCSS('color', await token(page, '--muted'));
  await expect(mark(one.title)).toHaveCount(0);

  await app.listOnDisk([one, { ...inside, cwd: PROJECT, worktree: '', leftWorktree: 'feature-x' }, left]);
  await expect(mark(inside.title)).toHaveCSS('color', await token(page, '--muted'));
});

// The bar is drawn again whenever an open tab's status changes, which can land between a press and its release, or under a button reached with the keyboard: a tab that stays where it is keeps both.
test('a press on a tab or its button still counts, and a focused button keeps the focus, when a status arrives', async ({ app, page }) => {
  await app.boot(fixture);
  // Each a status `one` does not have yet, so each draws the bar again: the same one twice changes nothing.
  const status = (state: string) => async (): Promise<void> => {
    expect(await app.emit('onSessionStatus', one.id, state, '', '')).toBe(1);
    await expect(tab(page, one.title).locator('.nudge')).toHaveClass(new RegExp(`\\b${state}\\b`));
  };

  const close = tab(page, other.title).locator('.tab-close');
  await close.focus();
  await status('busy')();
  await expect(close).toBeFocused();

  await clickAcross(page, tab(page, other.title).locator('.tab-label'), status('idle'));
  await expect(tab(page, other.title)).toHaveClass(/\bactive\b/);

  // The button's icon is its own element, over the middle of the button, where a press lands; `one` was never started, so the press closes its tab.
  await clickAcross(page, tab(page, one.title).locator('.tab-close'), status('waiting'));
  await expect(tab(page, one.title)).toHaveCount(0);
});

test('a middle click stops the tab of a running session, and closes it once it is cold', async ({ app, page }) => {
  await app.boot(fixture);
  await tab(page, other.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, 'claude is here')).toBe(1);
  await tab(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);

  await tab(page, other.title).click({ button: 'middle' });
  expect(await app.calls('closeTerminal')).toEqual([[1, false]]);
  await app.emit('onTerminalExit', 1, 0);
  await expect(tab(page, other.title)).toHaveClass(/\bcold\b/);
  // Not chosen by it: the tab on show stays on show.
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);

  await tab(page, other.title).click({ button: 'middle' });
  await expect(tab(page, other.title)).toHaveCount(0);
  expect(await app.calls('closeTerminal')).toEqual([[1, false]]);
});
