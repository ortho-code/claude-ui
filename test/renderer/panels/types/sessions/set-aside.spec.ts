import type { Locator, Page } from '@playwright/test';
import { session, settingsFileWith } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { lookOf, token } from '../../../support/looks';
import { row, stripRow, switcherEntry, tab, tabLabels } from '../../../support/window';

// A session set aside for later carries a bookmark on its row, its tab and its strip row by one rule, until a prompt there, Clear later, an archive or its day coming takes it off (decided 2026-10-29).
// Its day coming makes it need you; a needs-you mark it came after is muted until then, and one that comes after it is not.
const one = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Set aside' });
const two = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Other session' });
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], history: { [one.id]: [], [two.id]: [] } };
// Thursday 29 October 2026, mid-afternoon, in the window's own time zone.
const THURSDAY = new Date(2026, 9, 29, 15, 30);

/** The session's bookmark on each surface that draws one: its row, its tab, and its strip row while the strip lists it. */
const marks = (page: Page, title = one.title): Locator[] => [row(page, title).locator('.set-aside-mark'), tab(page, title).locator('.set-aside-mark')];

/** Open a session's menu from its row's kebab, and answer one of its items, or of Later's submenu. */
async function menuItem(page: Page, title: string, item: string): Promise<Locator> {
  await row(page, title).locator('.session-kebab').click();
  return page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

async function pickSetAside(page: Page, title: string, choice: RegExp): Promise<void> {
  await (await menuItem(page, title, 'Later')).click();
  await page.locator('.kebab-menu.submenu button.menu-row', { hasText: choice }).click();
}

/** A local moment in the window's time zone, as the menu works it out. */
const momentInPage = (page: Page, year: number, month: number, day: number, hours: number, minutes: number): Promise<number> =>
  page.evaluate(([y, mo, d, h, mi]) => new Date(y, mo, d, h, mi).getTime(), [year, month, day, hours, minutes] as const);

test('Later marks the session on its row and its tab by one class, and Clear later takes it off, with the tab left as it was', async ({ app, page }) => {
  await app.boot(fixture);
  await pickSetAside(page, one.title, /^Whenever$/);
  for (const mark of marks(page)) {
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-tooltip', 'Later');
  }
  await expect(row(page, one.title).locator('.set-aside-mark')).toHaveClass(/\bset-aside-badge\b/);
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], null]]);
  expect(await app.calls('startTerminal')).toEqual([]);
  await expect(tab(page, one.title)).toHaveCount(1);

  await (await menuItem(page, one.title, 'Clear later')).click();
  for (const mark of marks(page)) await expect(mark).toBeHidden();
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
  await expect(await menuItem(page, two.title, 'Clear later')).toHaveAttribute('data-tooltip', 'Not marked for later');
});

test("Later's days: tomorrow and in a week, the same weekday, named and marked at the settings' time of day, and the header saying which", async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Later')).click();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['Tomorrow (Fri 30 Oct, 09:00)', 'In a week (Thu 5 Nov, 09:00)', 'Pick a date…', 'Whenever']);
  await page.locator('.kebab-menu.submenu button.menu-row', { hasText: /^In a week/ }).click();
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], await momentInPage(page, 2026, 10, 5, 9, 0)]]);
  for (const mark of marks(page)) await expect(mark).toHaveAttribute('data-tooltip', 'Later: Thu 5 Nov, 09:00');

  await row(page, one.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu .menu-header .menu-header-line', { hasText: /^Later: Thu 5 Nov, 09:00$/ })).toHaveCount(1);
});

test('on a Sunday, in a week is the next Sunday, not the same day as tomorrow', async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 1, 10, 0));
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Later')).click();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['Tomorrow (Mon 2 Nov, 09:00)', 'In a week (Sun 8 Nov, 09:00)', 'Pick a date…', 'Whenever']);
});

test('Pick a date… asks for a day no earlier than tomorrow and a time starting at the settings\', naming the session in its title as the Note dialog does, and marks the session until that moment', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot(fixture);
  await pickSetAside(page, one.title, /^Pick a date…$/);
  await expect(page.locator('#day-overlay')).toBeVisible();
  await expect(page.locator('#day-title')).toHaveText(`Later: ${one.title}`);
  await expect(page.locator('#day-detail')).toHaveText('Pick the day and time it comes back as needing you.');
  await expect(page.locator('#day-ok')).toBeDisabled();
  await expect(page.locator('#day-time')).toHaveValue('09:00');
  await expect(page.locator('#day-calendar .air-datepicker-cell.-day-[data-date="29"][data-month="9"]')).toHaveClass(/-disabled-/);
  await page.locator('#day-calendar .air-datepicker-cell.-day-[data-date="31"][data-month="9"]').click();
  await page.locator('#day-time').fill('');
  await expect(page.locator('#day-ok')).toBeDisabled();
  await page.locator('#day-time').fill('14:15');
  await page.locator('#day-ok').click();
  await expect(page.locator('#day-overlay')).toBeHidden();
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], await momentInPage(page, 2026, 9, 31, 14, 15)]]);
  await expect(row(page, one.title).locator('.set-aside-mark')).toHaveAttribute('data-tooltip', 'Later: Sat 31 Oct, 14:15');
});

test("Pick a date…'s title and the Note dialog's, naming the session, break a long word to fit", async ({ app, page }) => {
  const long = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'x'.repeat(200) });
  await app.boot({ sessions: [long], openSessions: [], history: { [long.id]: [] } });
  await pickSetAside(page, long.title, /^Pick a date…$/);
  const dayTitle = page.locator('#day-title');
  await expect(dayTitle).toHaveText(`Later: ${long.title}`);
  expect(await dayTitle.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#day-cancel').click();

  await (await menuItem(page, long.title, 'Add note…')).click();
  const noteTitle = page.locator('#rename-title');
  await expect(noteTitle).toHaveText(`Note: ${long.title}`);
  await expect(page.locator('#rename-path')).toHaveText('Shown when you hover the note mark on its row; save it empty to remove it.');
  expect(await noteTitle.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

// The filter's calendar and this one are one (calendar.ts): it was drawn in the library's own light look, its weeks from Sunday, the time field against it.
test("Pick a date…'s calendar is the filter's: the app's palette, weeks from the language's first day, and the time set apart under it", async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { locale: 'en-GB' }) });
  await pickSetAside(page, one.title, /^Pick a date…$/);
  const cal = page.locator('#day-calendar .air-datepicker');
  expect((await lookOf(cal)).background).toBe('rgba(0, 0, 0, 0)');
  expect((await lookOf(page.locator('#day-calendar .air-datepicker-cell.-day-[data-date="31"][data-month="9"]'))).color).toBe(await token(page, '--text'));
  await expect(page.locator('#day-calendar .air-datepicker-body--day-name').first()).toHaveText(/^mo$/i);
  const calendarBottom = (await cal.boundingBox())!;
  const time = (await page.locator('#day-time').boundingBox())!;
  expect(time.y - (calendarBottom.y + calendarBottom.height)).toBeGreaterThanOrEqual(8);
});

test("a prompt there takes it off, a scheduled task's turn and its tab's close do not", async ({ app, page }) => {
  const tick = { prompt: 'Reply with the single word tick.', recurring: true, cron: 'Every minute' };
  await app.boot({ ...fixture, later: { [one.id]: { due: null, at: 1 } }, scheduledWhenStopped: { [one.id]: [tick] } });
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, tick.prompt);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
  expect(await app.calls('clearSetAside')).toEqual([]);

  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, 'what next?');
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
});

test('archiving it takes the mark off, and Undo gives it back as it was', async ({ app, page }) => {
  await app.boot({ ...fixture, later: { [one.id]: { due: null, at: 7 } } });
  await (await menuItem(page, one.title, 'Archive')).click();
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.later)).toEqual({});
  await page.locator('#toast-action').click();
  await expect(tab(page, one.title)).toHaveCount(1);
  for (const mark of marks(page)) await expect(mark).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.later)).toEqual({ [one.id]: { due: null, at: 7 } });
});

test('a day that came while the app was closed makes the session need you at launch, with the reminder, the bookmark gone', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  const due = new Date(2026, 9, 28, 9, 0).getTime();
  await app.boot({ ...fixture, later: { [one.id]: { due, at: 1 } } });
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(row(page, one.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — reminder for Wed 28 Oct, 09:00');
  for (const mark of marks(page)) await expect(mark).toBeHidden();
  await expect(stripRow(page, one.title)).toHaveCount(1);
  expect(await app.calls('setAsideCameDue')).toHaveLength(1);
});

// Each when it comes, not at an hourly look: the timer is set for the soonest, then for the next.
test('a moment that comes while the app runs shows when it comes, the next one after it in turn', async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 9, 30, 8, 0) });
  await app.boot({ ...fixture, later: { [two.id]: { due: new Date(2026, 9, 30, 8, 10).getTime(), at: 1 }, [one.id]: { due: new Date(2026, 9, 30, 8, 40).getTime(), at: 1 } } });
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
  await page.clock.fastForward('11:00');
  await expect(row(page, two.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(row(page, two.title).locator('.set-aside-mark')).toBeHidden();
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
  await page.clock.fastForward('30:00');
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
});

test('a needs-you mark from before the later mark is muted, read-looking and counted nowhere, and keeps its reason for when the day comes', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ reason: 'quit', at: 5 }] }, later: { [one.id]: { due: null, at: 10 } } });
  const dot = row(page, one.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bneeds\b.*\backed\b|\backed\b.*\bneeds\b/);
  await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit (read)');
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\backed\b/);
  await expect(switcherEntry(page, 'demo').locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  // A cold tab set aside is not work in hand, so the strip, which lists only what runs or needs you, has nothing.
  await expect(stripRow(page, one.title)).toHaveCount(0);
});

// The dot shows the mark over idle, read-looking; the roll-ups follow the dot, so an idle session so set aside nudges nowhere, while claude asking still does.
test('a muted session that runs and is idle rolls up as read, and one whose claude asks still counts', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ reason: 'quit', at: 5 }] }, later: { [one.id]: { due: null, at: 10 } } });
  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'idle', '', 'Stop');
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b.*\backed\b|\backed\b.*\bneeds\b/);
  await expect(switcherEntry(page, 'demo').locator('.nudge')).not.toHaveClass(/\bidle\b|\bneeds\b/);
  await expect(page.locator('#strip-label')).toHaveText('1 live');

  await app.emit('onSessionStatus', one.id, 'waiting', '', 'PermissionRequest');
  await expect(switcherEntry(page, 'demo').locator('.nudge')).toHaveClass(/\bwaiting\b/);
  await expect(page.locator('#strip-label')).toHaveText('1 of 1 need you');
});

test('a day coming on a session that already needs you keeps its reason, and lights it up again', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ reason: 'quit', at: 5 }] }, later: { [one.id]: { due: new Date(2026, 9, 28).getTime(), at: 10 } } });
  const dot = row(page, one.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bneeds\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit');
  await expect(stripRow(page, one.title)).toHaveCount(1);
});

test('a needs-you mark after the later mark is news, shown and counted in full, with the bookmark on its strip row too', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ reason: 'quit', at: 20 }] }, later: { [one.id]: { due: null, at: 10 } } });
  const dot = row(page, one.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bneeds\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(switcherEntry(page, 'demo').locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(stripRow(page, one.title)).toHaveCount(1);
  await expect(stripRow(page, one.title).locator('.set-aside-mark')).toBeVisible();
  await expect(page.locator('#strip-label')).toHaveText('1 of 1 need you');
});

test('a prompt there settles both marks', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ reason: 'quit', at: 5 }] }, later: { [one.id]: { due: null, at: 10 } } });
  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, 'carry on');
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id]]);
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
});

// Later took over setting a session aside, so pause and its force are gone from every menu, whatever the tab is doing (decided 2026-10-29).
test('no menu offers Pause or its force, on a cold tab, a running one or one whose claude is leaving', async ({ app, page }) => {
  await app.boot(fixture);
  const noPause = async (): Promise<void> => {
    await row(page, one.title).locator('.session-kebab').click();
    await expect(page.locator('.kebab-menu button.menu-row', { hasText: /^Later$/ })).toBeVisible();
    await expect(page.locator('.kebab-menu button.menu-row', { hasText: /paus/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  };
  await noPause();
  await startLive(page, app);
  await noPause();
  await tab(page, one.title).locator('.tab-close').click();
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bstopping\b/);
  await noPause();
});

/** Start the session's tab, so it runs. */
async function startLive(page: Page, app: App): Promise<void> {
  await tabLabels(page).filter({ hasText: one.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
}
