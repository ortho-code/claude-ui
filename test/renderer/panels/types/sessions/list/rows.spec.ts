import type { Locator } from '@playwright/test';
import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { token } from '../../../../support/looks';
import { row, tabLabel, tabs } from '../../../../support/window';

// A row says what its session's tab is doing (docs/architecture.md § Tab lifecycle): `open` while it has a tab, `cold` while that tab has no claude behind it, and `active-session` for the tab on show.
// Accent means a live session, nowhere else, so the cold bar is muted where the live one is accent.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Another session' });
const fixture = { sessions: [one, two], history: { [one.id]: [], [two.id]: [] } };

test('a row is marked open, cold and on show as its tab is', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [one.id] });
  await expect(row(page, one.title)).toHaveClass(/\bopen\b/);
  await expect(row(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bactive-session\b/);
  await expect(row(page, two.title)).not.toHaveClass(/\bopen\b/);

  // Selecting it starts it: live, and the one on show.
  await tabLabel(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(row(page, one.title)).not.toHaveClass(/\bcold\b/);
  await expect(row(page, one.title)).toHaveClass(/\bactive-session\b/);

  // Stopped: cold again, and no longer on show.
  await tabs(page).locator('.tab-close').click();
  await app.emit('onTerminalExit', 1, 0);
  await expect(row(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bactive-session\b/);
  await expect(row(page, one.title)).toHaveClass(/\bopen\b/);

  // Closed: no tab, no marks.
  await tabs(page).locator('.tab-close').click();
  await expect(row(page, one.title)).not.toHaveClass(/\bopen\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bcold\b/);
});

test("a row's dot follows its session's status, and a click on it marks it read without opening the session", async ({ app, page }) => {
  await app.boot(fixture);
  const dot = row(page, two.title).locator('.nudge');
  await expect(dot).not.toHaveClass(/\bwaiting\b/);

  expect(await app.emit('onSessionStatus', two.id, 'waiting', '', 'Notification')).toBe(1);
  await expect(dot).toHaveClass(/\bwaiting\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);

  // A click that reached the row would open the session in a tab.
  await dot.click();
  await expect(dot).toHaveClass(/\backed\b/);
  await dot.click();
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(tabs(page)).toHaveCount(0);
  expect(await app.calls('startTerminal')).toEqual([]);
});

// A session that left its worktree still did its work there (docs/architecture.md § Reading sessions), so its badge stays, muted, while a resume runs where it is now.
test("a row's worktree badge is accent while its session is in the worktree, and muted once the session has left it", async ({ app, page }) => {
  const inside = session({ id: '00000000-0000-4000-8000-000000000003', title: 'In its worktree', cwd: `${PROJECT}/.claude/worktrees/feature-x`, worktree: 'feature-x' });
  const left = session({ id: '00000000-0000-4000-8000-000000000004', title: 'Left its worktree', leftWorktree: 'feature-y' });
  await app.boot({ sessions: [one, inside, left] });
  const badge = (title: string): Locator => row(page, title).locator('.worktree-badge');

  await expect(badge(inside.title)).toBeVisible();
  await expect(badge(inside.title)).toHaveAttribute('data-tooltip', 'Linked git worktree: feature-x');
  await expect(badge(inside.title)).toHaveCSS('color', await token(page, '--accent'));
  await expect(badge(left.title)).toBeVisible();
  await expect(badge(left.title)).toHaveAttribute('data-tooltip', `Ran in linked git worktree: feature-y; now back in ${PROJECT}`);
  await expect(badge(left.title)).toHaveCSS('color', await token(page, '--muted'));
  await expect(badge(left.title)).toHaveCSS('border-top-color', await token(page, '--muted'));
  await expect(badge(one.title)).toBeHidden();

  // Leaving a worktree it entered while the app runs, which writes an exit into the session's transcript.
  await app.listOnDisk([one, { ...inside, cwd: PROJECT, worktree: '', leftWorktree: 'feature-x' }, left]);
  await expect(badge(inside.title)).toHaveCSS('color', await token(page, '--muted'));
  await expect(badge(inside.title)).toHaveAttribute('data-tooltip', `Ran in linked git worktree: feature-x; now back in ${PROJECT}`);
});
