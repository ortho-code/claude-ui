import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { exitLater } from '../../../../support/clock';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, switcherEntry, tab, tabLabels, toastButton } from '../../../../support/window';

// A session marked as needing you, as a launch marks the ones that were running when the app closed (resume.spec.ts), keeps the mark until you act on it: a prompt there, Clear needs you, closing its tab, leaving claude yourself, or finishing it.
// Its dot shows it where claude says nothing more pressing, on its row, its tab and its strip row alike, and a click there only marks it seen (decided 2026-10-28).
const one = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Marked session' });
const two = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Other session' });
const mark = { reason: 'quit' as const, at: 1 };
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], needsYou: { [one.id]: [mark] }, history: { [one.id]: [], [two.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The marked session's dot on each surface that draws one for it. */
const dots = (page: Page, title = one.title): Locator[] => [row(page, title).locator('.nudge'), tab(page, title).locator('.nudge'), stripRow(page, title).locator('.nudge')];

async function expectMarked(page: Page, marked: boolean): Promise<void> {
  for (const dot of dots(page)) {
    if (marked) await expect(dot).toHaveClass(/\bneeds\b/);
    else await expect(dot).not.toHaveClass(/\bneeds\b/);
  }
}

/** An item of a session's menu, from its row's kebab, opened first. */
async function menuItem(page: Page, title: string, item: string): Promise<Locator> {
  await row(page, title).locator('.session-kebab').click();
  return page.locator('.kebab-menu button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

/** Start the marked session's tab and let claude print, so the tab is live; answers its token. */
async function startLive(page: Page, app: App): Promise<string> {
  await tabLabels(page).filter({ hasText: one.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  return launch.tabToken ?? '';
}

test('the mark shows on its row, its tab and its strip row by one class, with its reason, and the roll-ups carry it', async ({ app, page }) => {
  await app.boot(fixture);
  await expectMarked(page, true);
  for (const dot of dots(page)) await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit');
  await expect(switcherEntry(page, 'demo').locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(page.locator('#strip-badge')).toHaveClass(/\bneeds\b/);
  // A marked tab is in hand, so the strip lists it though it does not run; the other cold tab is not listed.
  await expect(stripRow(page, two.title)).toHaveCount(0);
  await expect(page.locator('#strip-label')).toHaveText('1 of 1 need you');
});

// The dot shows the strongest state; the menu's header lists each, with its dot, under where the session is filed (decided 2026-10-28).
test("the menu's header lists every state the session is in, each with its dot, the needs-you mark saying why", async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'idle' } });
  await row(page, one.title).locator('.session-kebab').click();
  const lines = page.locator('.kebab-menu .menu-header .menu-header-line');
  await expect(lines.nth(1)).toHaveText('demo');
  const dotted = page.locator('.kebab-menu .menu-header .menu-header-line.dotted');
  await expect(dotted).toHaveText(['Idle', 'Needs you — was running when the app quit']);
  await expect(dotted.nth(0).locator('.nudge')).toHaveClass(/\bidle\b/);
  await expect(dotted.nth(1).locator('.nudge')).toHaveClass(/\bneeds\b/);
});

// Every reason is listed, by rank and then newest first (decided 2026-10-29); one dot stands for them all.
test("a session with two reasons lists both in its dot's tooltip and its menu's header, and a prompt takes both off", async ({ app, page }) => {
  const reminder = { reason: 'reminder' as const, at: new Date(2026, 10, 2, 9).getTime() };
  await app.boot({ ...fixture, needsYou: { [one.id]: [mark, reminder] } });
  for (const dot of dots(page)) await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit\nNeeds you — reminder for Mon 2 Nov, 09:00');
  await row(page, one.title).locator('.session-kebab').click();
  const dotted = page.locator('.kebab-menu .menu-header .menu-header-line.dotted');
  await expect(dotted).toHaveText(['Needs you — was running when the app quit', 'Needs you — reminder for Mon 2 Nov, 09:00']);
  for (const line of await dotted.all()) await expect(line.locator('.nudge')).toHaveClass(/\bneeds\b/);
  await page.keyboard.press('Escape');

  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit');
  await expectMarked(page, false);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({});
});

test('a resume keeps the mark, and a prompt there takes it off everywhere', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await expectMarked(page, true);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit');
  await expectMarked(page, false);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id]]);
  await expect(switcherEntry(page, 'demo').locator('.nudge')).not.toHaveClass(/\bneeds\b/);
});

// A turn claude starts itself fires UserPromptSubmit too (measured on claude 2.1.310): a background task's end, and a scheduled task firing, which a resumed session's tab knows from what it kept before any Stop lists it.
test("a turn claude starts itself keeps the mark: a background task's end, and a scheduled task firing", async ({ app, page }) => {
  const tick = { prompt: 'Reply with the single word tick.', recurring: true, cron: 'Every minute' };
  await app.boot({ ...fixture, scheduledWhenStopped: { [one.id]: [tick] } });
  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, '<task-notification>\n<task-id>b1</task-id>');
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, tick.prompt);
  await app.emit('onSessionStatus', one.id, 'idle', '', 'Stop');
  await expectMarked(page, true);
  expect(await app.calls('clearNeedsYou')).toEqual([]);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, 'what next?');
  await expectMarked(page, false);
});

// Claude working or asking shows over the mark, which comes back once it has done; only a prompt submitted takes it off.
test('busy, background and waiting show over the mark, and idle gives way to it', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  for (const [status, event] of [
    ['busy', 'PostToolUse'],
    ['background', 'Stop'],
    ['waiting', 'PermissionRequest'],
  ] as const) {
    await app.emit('onSessionStatus', one.id, status, '', event);
    for (const dot of dots(page)) await expect(dot).toHaveClass(new RegExp(`\\b${status}\\b`));
  }
  await app.emit('onSessionStatus', one.id, 'idle', '', 'Stop');
  await expectMarked(page, true);
  expect(await app.calls('clearNeedsYou')).toEqual([]);
});

test('a click on its dot marks it seen, dimmed, and keeps the mark', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).locator('.nudge').click();
  for (const dot of dots(page)) await expect(dot).toHaveClass(/\bneeds\b.*\backed\b|\backed\b.*\bneeds\b/);
  await expect(row(page, one.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit (read)');
  expect(await app.calls('clearNeedsYou')).toEqual([]);
  // Seen is not settled: nothing nudges from the roll-ups, and the strip still lists it.
  await expect(switcherEntry(page, 'demo').locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  await expect(stripRow(page, one.title)).toHaveCount(1);
});

test('Clear needs you in its menu takes it off without opening it', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Clear needs you')).click();
  for (const dot of [row(page, one.title).locator('.nudge'), tab(page, one.title).locator('.nudge')]) await expect(dot).not.toHaveClass(/\bneeds\b/);
  // A cold tab with nothing in hand any more leaves the strip.
  await expect(stripRow(page, one.title)).toHaveCount(0);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id]]);
  expect(await app.calls('startTerminal')).toEqual([]);
  await expect(await menuItem(page, two.title, 'Clear needs you')).toHaveAttribute('data-tooltip', 'Not marked as needing you');
});

test('closing its tab takes the mark off, and Undo puts it back with the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id]]);

  await toastButton(page, 'Undo').click();
  await expectMarked(page, true);
  // Put back as it was, from when it was marked, so a set-aside mark that muted it mutes it again.
  expect(await app.calls('markNeedsYou')).toEqual([[[one.id], [mark]]]);
});

test('finishing it takes the mark off, and Undo puts it back with the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Finished')).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({});

  await toastButton(page, 'Undo').click();
  await expect(tab(page, one.title)).toHaveCount(1);
  await expectMarked(page, true);
});

// A session with no tab has nothing for Undo's put-back to carry the mark on, so the finish keeps it for Undo itself.
test('finishing a marked session that has no tab takes the mark off, and Undo puts it back as it was', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [two.id] });
  await (await menuItem(page, one.title, 'Finished')).click();
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({});

  await toastButton(page, 'Undo').click();
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({ [one.id]: [mark] });
  await expect(tab(page, one.title)).toHaveCount(0);
});

// Leaving claude yourself, by `/exit`, Ctrl-D or two Ctrl-Cs, exits 0; a signal or a crash does not (measured on claude 2.1.310), so the mark outlives the tab then.
test("claude's own exit takes the mark off with its tab when it exits 0, and keeps it otherwise", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await exitLater(page);
  await app.emit('onTerminalExit', FIRST, 143);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([]);
});

// node-pty reports a death by a signal claude cannot catch, SIGKILL or a native crash, with code 0 and the signal.
test('a claude killed by a signal it cannot catch keeps the mark, though its code is 0', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await exitLater(page);
  await app.emit('onTerminalExit', FIRST, 0, 9);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([]);
});

test("claude's own exit with 0 takes the mark off with its tab", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await exitLater(page);
  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id]]);
});

// The tab no longer holds the session, which settles it as a close does; the session the tab goes on in needs nothing yet.
test('a /clear in its tab takes the old session\'s mark off and does not mark the new one', async ({ app, page }) => {
  await app.boot(fixture);
  const token = await startLive(page, app);
  const next = '00000000-0000-4000-8000-0000000000e3';
  expect(await app.emit('onSessionStart', next, token, 'clear')).toBe(1);
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id]]);
  expect(await app.calls('markNeedsYou')).toEqual([]);
});
