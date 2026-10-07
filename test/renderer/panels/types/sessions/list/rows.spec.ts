import type { Locator } from '@playwright/test';
import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { token } from '../../../../support/looks';
import { clickAcross } from '../../../../support/press';
import { project, projectHeading, row, tabLabel, tabs } from '../../../../support/window';

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

// The list is drawn again whenever what it shows changes, which can land between a press and its release, or under a control you reached with the keyboard: a row it already shows stays where it is, so the click still counts and the focus stays put.
test('a press on a row still counts, and a focused control keeps the focus, when the list is drawn again', async ({ app, page }) => {
  const three = session({ id: '00000000-0000-4000-8000-000000000005', title: 'A third session' });
  // `one` is listed last, so it is the bottom row: a row leaving above the pressed one would slide that one out from under the pointer, which no redraw can help.
  // In All, where a project's heading folds it.
  await app.boot({ sessions: [two, three, one], activeProject: null, history: { [two.id]: [], [three.id]: [] } });
  // Each a model `one` has not shown yet, so each draws the list again: the same one twice changes nothing.
  const redraw = (model: string, label: string) => async (): Promise<void> => {
    expect(await app.emit('onSessionModel', one.id, model)).toBe(1);
    await expect(row(page, one.title)).toContainText(label);
  };

  const pin = row(page, two.title).locator('.pin');
  await pin.focus();
  await redraw('claude-sonnet-4-5', 'Sonnet 4.5')();
  await expect(pin).toBeFocused();

  await clickAcross(page, row(page, two.title).locator('.card-title'), redraw('claude-haiku-4-5', 'Haiku 4.5'));
  await expect(tabLabel(page, two.title)).toBeVisible();

  // The pin's icon is its own element, over the middle of the button, where a press lands.
  await clickAcross(page, pin, redraw('claude-fable-5', 'Fable 5'));
  await expect.poll(() => app.calls('togglePin')).toEqual([[two.id]]);

  // The icons the list draws again with it: the folder in front of a project's name, the caret beside it, and collapse-all's.
  const demo = project(page, 'demo');
  await clickAcross(page, projectHeading(page, 'demo').locator('.heading-icon'), redraw('claude-opus-5-5', 'Opus 5.5'));
  await expect(demo).toHaveClass(/\bcollapsed\b/);
  await clickAcross(page, projectHeading(page, 'demo').locator('.caret'), redraw('claude-sonnet-4-5', 'Sonnet 4.5'));
  await expect(demo).not.toHaveClass(/\bcollapsed\b/);
  const collapseAll = page.locator('#collapse-toggle');
  await clickAcross(page, collapseAll, redraw('claude-haiku-4-5', 'Haiku 4.5'));
  await expect(demo).toHaveClass(/\bcollapsed\b/);
  await collapseAll.click();
  await expect(demo).not.toHaveClass(/\bcollapsed\b/);

  // A row leaving below the pressed one moves the pressed one nowhere.
  await clickAcross(page, row(page, three.title).locator('.card-title'), () => app.listOnDisk([two, three]));
  await expect(row(page, one.title)).toHaveCount(0);
  await expect(tabLabel(page, three.title)).toBeVisible();
});
