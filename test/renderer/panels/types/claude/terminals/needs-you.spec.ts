import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { exitLater } from '../../../../support/clock';
import { session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { switchedOff } from '../../../../support/needsyou';
import { openSettings } from '../../../../support/settings';
import { row, switcherRollUp, tab, tabLabels, toastButton } from '../../../../support/window';

// A session marked as needing you, as a launch marks the ones that were running when the app closed (resume.spec.ts), keeps the mark until you act on it: a prompt there, Clear needs you, closing its tab, leaving claude yourself, or finishing it.
// Its dot shows it where claude says nothing more pressing, on its row and its tab alike, and a click there only marks it seen (decided 2026-10-28).
const one = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Marked session' });
const two = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Other session' });
const mark = { type: 'app.was-running' as const, at: 1, how: 'quit' as const };
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], needsYou: { [one.id]: [mark] }, history: { [one.id]: [], [two.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The marked session's dot on each surface that draws one for it. */
const dots = (page: Page, title = one.title): Locator[] => [row(page, title).locator('.nudge'), tab(page, title).locator('.nudge')];

async function expectMarked(page: Page, marked: boolean): Promise<void> {
  for (const dot of dots(page)) {
    if (marked) await expect(dot).toHaveClass(/\bneeds\b/);
    else await expect(dot).not.toHaveClass(/\bneeds\b/);
  }
}

/** The marked session's reason in main's history, settled by `by`: what each act that takes the mark off records (decided 2026-11-06). */
async function expectSettled(page: Page, by: string): Promise<void> {
  await expect.poll(() => page.evaluate((id) => window.__claudeUiFixture.needsYouHistory[id], one.id)).toEqual([{ ...mark, settled: expect.any(Number), by }]);
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

test('the mark shows on its row and its tab by one class, with its reason, and the roll-ups carry it', async ({ app, page }) => {
  await app.boot(fixture);
  await expectMarked(page, true);
  for (const dot of dots(page)) await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit');
  await expect(switcherRollUp(page, 'demo')).toHaveClass(/\bneeds\b/);
});

// The dot shows the strongest state; the menu's header lists each, with its dot, under where the session is filed, in the strength order, the dot's first (decided 2026-10-28, ordered 2026-11-06).
test("the menu's header lists every state the session is in, each with its dot, the needs-you mark saying why", async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'idle' } });
  await row(page, one.title).locator('.session-kebab').click();
  const lines = page.locator('.kebab-menu .menu-header .menu-header-line');
  await expect(lines.nth(1)).toHaveText('demo');
  const dotted = page.locator('.kebab-menu .menu-header .menu-header-line.dotted');
  await expect(dotted).toHaveText(['Needs you — was running when the app quit', 'Idle']);
  await expect(dotted.nth(0).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(dotted.nth(1).locator('.nudge')).toHaveClass(/\bidle\b/);
});

// The tooltip lists every state, as the header does, so a mark a busy dot does not show is still there on hover (decided 2026-11-06).
test("a session marked while claude works shows busy on its dot, and its tooltip lists the mark under it", async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'busy' } });
  for (const dot of dots(page)) {
    await expect(dot).toHaveClass(/\bbusy\b/);
    await expect(dot).toHaveAttribute('data-tooltip', 'Busy\nNeeds you — was running when the app quit');
  }
});

// The strength order is yours, in settings.json: a category named over busy shows over claude working, on every dot and in the tooltip's order.
test('a strength order naming Reminders over busy shows the mark over a busy claude', async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'busy' }, settings: settingsFileWith('settings.json', { strength: ['waiting', 'reminders', 'busy', 'background', 'needs-you', 'idle', 'closed'] }) });
  for (const dot of dots(page)) {
    await expect(dot).toHaveClass(/\bneeds\b/);
    await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit\nBusy');
  }
});

test('a strength order changed on disk while the app runs repaints every dot and roll-up at once', async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'idle' } });
  for (const dot of dots(page)) await expect(dot).toHaveClass(/\bneeds\b/);
  await expect(switcherRollUp(page, 'demo')).toHaveClass(/\bneeds\b/);
  await app.settingsOnDisk(settingsFileWith('settings.json', { strength: ['waiting', 'busy', 'background', 'idle', 'needs-you', 'closed'] }));
  for (const dot of dots(page)) await expect(dot).toHaveClass(/\bidle\b/);
  await expect(switcherRollUp(page, 'demo')).toHaveClass(/\bidle\b/);
});

test('a strength order with a mistake is not used, and Settings says why', async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'busy' }, settings: settingsFileWith('settings.json', { strength: ['waiting', 'reminder', 'busy', 'background', 'needs-you', 'idle', 'closed'] }) });
  for (const dot of dots(page)) await expect(dot).toHaveClass(/\bbusy\b/);
  const dialog = await openSettings(page);
  await expect(dialog.locator('#settings-dots-problems')).toHaveText(
    'The order in settings.json is not used: "reminder" is neither a status, "needs-you" nor a needs-you category.',
  );
});

// Every reason is listed, by its category's place in the strength order and then newest first (decided 2026-10-29, by category 2026-11-06); one dot stands for them all.
test("a session with two reasons lists both in its dot's tooltip and its menu's header, and a prompt takes both off", async ({ app, page }) => {
  const reminder = { type: 'app.reminder' as const, at: new Date(2026, 10, 2, 9).getTime() };
  await app.boot({ ...fixture, needsYou: { [one.id]: [mark, reminder] } });
  for (const dot of dots(page)) await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — reminder for Mon 2 Nov, 09:00\nNeeds you — was running when the app quit');
  await row(page, one.title).locator('.session-kebab').click();
  const dotted = page.locator('.kebab-menu .menu-header .menu-header-line.dotted');
  await expect(dotted).toHaveText(['Needs you — reminder for Mon 2 Nov, 09:00', 'Needs you — was running when the app quit']);
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
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id, 'prompt']]);
  await expectSettled(page, 'prompt');
  await expect(switcherRollUp(page, 'demo')).not.toHaveClass(/\bneeds\b/);
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
  // Seen is not settled: nothing nudges from the roll-ups.
  await expect(switcherRollUp(page, 'demo')).not.toHaveClass(/\bneeds\b/);
});

test('Clear needs you in its menu takes it off without opening it', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Clear needs you')).click();
  for (const dot of [row(page, one.title).locator('.nudge'), tab(page, one.title).locator('.nudge')]) await expect(dot).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id, 'cleared']]);
  await expectSettled(page, 'cleared');
  expect(await app.calls('startTerminal')).toEqual([]);
  await expect(await menuItem(page, two.title, 'Clear needs you')).toHaveAttribute('data-tooltip', 'Not marked as needing you');
});

test('closing its tab takes the mark off, and Undo puts it back with the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id, 'closed']]);
  await expectSettled(page, 'closed');

  await toastButton(page, 'Undo').click();
  await expectMarked(page, true);
  // Put back as it was, from when it was marked, so a set-aside mark that muted it mutes it again, and taken back off its history, so the undone close leaves no trace.
  expect(await app.calls('restoreNeedsYou')).toEqual([[one.id, [mark]]]);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYouHistory)).toEqual({});
});

test('finishing it takes the mark off, and Undo puts it back with the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Finished')).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({});
  await expectSettled(page, 'finished');

  await toastButton(page, 'Undo').click();
  await expect(tab(page, one.title)).toHaveCount(1);
  await expectMarked(page, true);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYouHistory)).toEqual({});
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
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id, 'closed']]);
});

// The tab no longer holds the session, which settles it as a close does; the session the tab goes on in needs nothing yet.
test('a /clear in its tab takes the old session\'s mark off and does not mark the new one', async ({ app, page }) => {
  await app.boot(fixture);
  const token = await startLive(page, app);
  const next = '00000000-0000-4000-8000-0000000000e3';
  expect(await app.emit('onSessionStart', next, token, 'clear')).toBe(1);
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id, 'moved']]);
  await expectSettled(page, 'moved');
  expect(await app.calls('markNeedsYou')).toEqual([]);
});

// Switching a type off retires the marks it made, into each session's history as off, rather than hiding them (decided 2026-11-06).
test('a type switched off settles the marks it made at launch, and one switched off while the app runs settles its own then', async ({ app, page }) => {
  const reminder = { type: 'app.reminder' as const, at: 2 };
  await app.boot({ ...fixture, needsYou: { [one.id]: [mark], [two.id]: [reminder] }, needsYouTypes: switchedOff('app.was-running') });
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  await expect(row(page, two.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  expect(await app.calls('settleNeedsYouTypes')).toEqual([[['app.was-running']]]);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYouHistory)).toEqual({ [one.id]: [{ ...mark, settled: expect.any(Number), by: 'off' }] });

  expect(await app.emit('onNeedsYouTypes', switchedOff('app.was-running', 'reminders'))).toBe(1);
  await expect(row(page, two.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({});
});

test('a needs-you file of yours with a mistake is said, and the others are in force', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYouTypes: { ...switchedOff('app.was-running'), problems: ['needs-you/b.json: nothing the app ships has the id "app.nope"'] } });
  await expect(page.locator('#toast')).toContainText('A needs-you file of yours is not used: needs-you/b.json: nothing the app ships has the id "app.nope"');
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
});
