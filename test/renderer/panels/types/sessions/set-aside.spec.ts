import type { Locator, Page } from '@playwright/test';
import { session, settingsFileWith } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { lookOf, token } from '../../../support/looks';
import { switchedOff } from '../../../support/needsyou';
import { row, switcherRollUp, tab, tabLabels, toastButton } from '../../../support/window';

// A session set aside carries a bookmark on its row and its tab by one rule, until a prompt there, Clear set aside, a finish or its day coming takes it off (decided 2026-10-29).
// Its day coming makes it need you; a needs-you mark it came after is muted until then, and one that comes after it is not.
// Set aside… asks when to come back and where it stands, which is the session's note, in one dialog (decided 2026-11-05).
const one = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Set aside' });
const two = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Other session' });
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], history: { [one.id]: [], [two.id]: [] } };
// Thursday 29 October 2026, mid-afternoon, in the window's own time zone.
const THURSDAY = new Date(2026, 9, 29, 15, 30);

/** The session's bookmark on each surface that draws one: its row and its tab. */
const marks = (page: Page, title = one.title): Locator[] => [row(page, title).locator('.set-aside-mark'), tab(page, title).locator('.set-aside-mark')];

const dialog = (page: Page): Locator => page.locator('#set-aside-overlay');
const choices = (page: Page): Locator => page.locator('#set-aside-choices button');
const choice = (page: Page, name: RegExp): Locator => page.locator('#set-aside-choices button', { hasText: name });
const ok = (page: Page): Locator => page.locator('#set-aside-ok');
const note = (page: Page): Locator => page.locator('#set-aside-note');

/** Open a session's menu from its row's kebab, and answer one of its items. */
async function menuItem(page: Page, title: string, item: string): Promise<Locator> {
  await row(page, title).locator('.session-kebab').click();
  return page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

/** Open Set aside… from a session's row. */
async function openSetAside(page: Page, title: string): Promise<void> {
  await (await menuItem(page, title, 'Set aside…')).click();
  await expect(dialog(page)).toBeVisible();
}

/** Set a session aside from its row, by one of the dialog's choices, its line left as it is. */
async function setAside(page: Page, title: string, name: RegExp): Promise<void> {
  await openSetAside(page, title);
  await choice(page, name).click();
  await ok(page).click();
  await expect(dialog(page)).toBeHidden();
}

/** A local moment in the window's time zone, as the dialog works it out. */
const momentInPage = (page: Page, year: number, month: number, day: number, hours: number, minutes: number): Promise<number> =>
  page.evaluate(([y, mo, d, h, mi]) => new Date(y, mo, d, h, mi).getTime(), [year, month, day, hours, minutes] as const);

test('Set aside… marks the session on its row and its tab by one class, and Clear set aside takes it off, with the tab left as it was', async ({ app, page }) => {
  await app.boot(fixture);
  await setAside(page, one.title, /^Whenever$/);
  for (const mark of marks(page)) {
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-tooltip', 'Set aside, whenever');
  }
  await expect(row(page, one.title).locator('.set-aside-mark')).toHaveClass(/\bset-aside-badge\b/);
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], null]]);
  expect(await app.calls('startTerminal')).toEqual([]);
  await expect(tab(page, one.title)).toHaveCount(1);
  // The session's menu raises no toast for it: the row stays where it was (decided 2026-11-04).
  await expect(page.locator('#toast-message')).toBeHidden();

  await (await menuItem(page, one.title, 'Clear set aside')).click();
  for (const mark of marks(page)) await expect(mark).toBeHidden();
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
  await expect(await menuItem(page, two.title, 'Clear set aside')).toHaveAttribute('data-tooltip', 'Not set aside');
});

test("the dialog's days: tomorrow and in a week, the same weekday, named and marked at the settings' time of day, and the header saying until when", async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await expect(page.locator('#set-aside-title')).toHaveText(`Set aside: ${one.title}`);
  await expect(choices(page)).toHaveText(['Tomorrow (Fri 30 Oct, 09:00)', 'In 1 week (Thu 5 Nov, 09:00)', 'Pick a date…', 'Whenever']);
  await choice(page, /^In 1 week/).click();
  await expect(choice(page, /^In 1 week/)).toHaveAttribute('aria-pressed', 'true');
  await ok(page).click();
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], await momentInPage(page, 2026, 10, 5, 9, 0)]]);
  for (const mark of marks(page)) await expect(mark).toHaveAttribute('data-tooltip', 'Set aside until Thu 5 Nov, 09:00');

  await row(page, one.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu .menu-header .menu-header-line', { hasText: /^Set aside until Thu 5 Nov, 09:00$/ })).toHaveCount(1);
});

test('on a Sunday, in a week is the next Sunday, not the same day as tomorrow', async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 1, 10, 0));
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await expect(choices(page)).toHaveText(['Tomorrow (Mon 2 Nov, 09:00)', 'In 1 week (Sun 8 Nov, 09:00)', 'Pick a date…', 'Whenever']);
});

test("the settings' own choices come in the order they would come, Pick a date… before Whenever, and one in hours counts from the press of Set aside", async ({ app, page }) => {
  await page.clock.install({ time: THURSDAY });
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { setAside: ['whenever', 'next monday', 'in 2h', 'in 1d', 'tomorrow 08:00'] }) });
  await openSetAside(page, one.title);
  // In 1 day and tomorrow at 08:00 fall on the same day at different times, so both stay.
  await expect(choices(page)).toHaveText(['In 2 hours (Thu 29 Oct, 17:30)', 'Tomorrow (Fri 30 Oct, 08:00)', 'In 1 day (Fri 30 Oct, 09:00)', 'Next Monday (Mon 2 Nov, 09:00)', 'Pick a date…', 'Whenever']);
  await choice(page, /^In 2 hours/).click();
  await page.clock.runFor(5 * 60_000);
  await ok(page).click();
  // The installed clock runs on between steps, so two hours from the press is a moment in the second after 17:35, never 17:30 as the label said.
  const [[ids, due]] = (await app.calls('markSetAside')) as [string[], number][];
  const from = await momentInPage(page, 2026, 9, 29, 17, 35);
  expect(ids).toEqual([one.id]);
  expect(due).toBeGreaterThanOrEqual(from);
  expect(due).toBeLessThan(from + 60_000);
});

test('without whenever in the settings, Pick a date… comes last, and two choices for one moment show once', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { setAside: ['in 1d', 'tomorrow'] }) });
  await openSetAside(page, one.title);
  await expect(choices(page)).toHaveText(['In 1 day (Fri 30 Oct, 09:00)', 'Pick a date…']);
});

test('Set aside waits for a choice, and Pick a date… opens a day no earlier than tomorrow and a time starting at the settings\' inside the dialog, and marks the session until that moment', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await expect(ok(page)).toBeDisabled();
  await expect(page.locator('#set-aside-pick')).toBeHidden();
  await choice(page, /^Pick a date…$/).click();
  await expect(page.locator('#set-aside-pick')).toBeVisible();
  await expect(ok(page)).toBeDisabled();
  await expect(page.locator('#set-aside-time')).toHaveValue('09:00');
  await expect(page.locator('#set-aside-calendar .air-datepicker-cell.-day-[data-date="29"][data-month="9"]')).toHaveClass(/-disabled-/);
  await page.locator('#set-aside-calendar .air-datepicker-cell.-day-[data-date="31"][data-month="9"]').click();
  await page.locator('#set-aside-time').fill('');
  await expect(ok(page)).toBeDisabled();
  await page.locator('#set-aside-time').fill('14:15');
  await ok(page).click();
  await expect(dialog(page)).toBeHidden();
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], await momentInPage(page, 2026, 9, 31, 14, 15)]]);
  await expect(row(page, one.title).locator('.set-aside-mark')).toHaveAttribute('data-tooltip', 'Set aside until Sat 31 Oct, 14:15');
});

test("the dialog holds the session's note as where it stands, the caret at its end, and Set aside leaves an unchanged note unwritten", async ({ app, page }) => {
  await app.boot({ ...fixture, notes: { [one.id]: 'waiting on review' } });
  await openSetAside(page, one.title);
  await expect(page.locator('#set-aside-where')).toHaveText('Where it stands');
  await expect(note(page)).toHaveValue('waiting on review');
  await expect(note(page)).toBeFocused();
  expect(await note(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([17, 17]);
  await expect(page.locator('#set-aside-notes-stay')).toBeHidden();
  await choice(page, /^Whenever$/).click();
  await ok(page).click();
  await expect(dialog(page)).toBeHidden();
  expect(await app.calls('setNote')).toEqual([]);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
});

test('a changed line is written as the note, and the note mark shows it', async ({ app, page }) => {
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await note(page).fill('waiting for Anna');
  await choice(page, /^Tomorrow/).click();
  await ok(page).click();
  await expect.poll(() => app.calls('setNote')).toEqual([[one.id, 'waiting for Anna']]);
  await expect(row(page, one.title).locator('.note-badge')).toBeVisible();
  expect(await app.calls('markSetAside')).toHaveLength(1);
});

test('Cancel and Esc change nothing, the line typed included', async ({ app, page }) => {
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await note(page).fill('never kept');
  await choice(page, /^Whenever$/).click();
  await page.locator('#set-aside-cancel').click();
  await expect(dialog(page)).toBeHidden();
  await openSetAside(page, one.title);
  await expect(note(page)).toHaveValue('');
  await choice(page, /^Whenever$/).click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  expect(await app.calls('markSetAside')).toEqual([]);
  expect(await app.calls('setNote')).toEqual([]);
});

test('Ctrl+Enter sets aside from the line, once a choice is made', async ({ app, page }) => {
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await page.keyboard.press('Control+Enter');
  await expect(dialog(page)).toBeVisible();
  await choice(page, /^Whenever$/).click();
  await note(page).focus();
  await page.keyboard.press('Control+Enter');
  await expect(dialog(page)).toBeHidden();
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], null]]);
});

test('one already set aside says until when under the title, chooses nothing, and Set aside replaces its mark', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot({ ...fixture, setAside: { [one.id]: { due: new Date(2026, 10, 5, 9, 0).getTime(), at: 1 } } });
  await openSetAside(page, one.title);
  await expect(page.locator('#set-aside-now')).toHaveText('Now set aside until Thu 5 Nov, 09:00.');
  await expect(page.locator('#set-aside-choices button[aria-pressed="true"]')).toHaveCount(0);
  await expect(ok(page)).toBeDisabled();
  await choice(page, /^Whenever$/).click();
  await ok(page).click();
  await expect(row(page, one.title).locator('.set-aside-mark')).toHaveAttribute('data-tooltip', 'Set aside, whenever');

  await openSetAside(page, two.title);
  await expect(page.locator('#set-aside-now')).toBeHidden();
});

test("Set aside…'s title and the Note dialog's, naming the session, break a long word to fit", async ({ app, page }) => {
  const long = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'x'.repeat(200) });
  await app.boot({ sessions: [long], openSessions: [], history: { [long.id]: [] } });
  await openSetAside(page, long.title);
  const title = page.locator('#set-aside-title');
  await expect(title).toHaveText(`Set aside: ${long.title}`);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#set-aside-cancel').click();

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
  await openSetAside(page, one.title);
  await choice(page, /^Pick a date…$/).click();
  const cal = page.locator('#set-aside-calendar .air-datepicker');
  expect((await lookOf(cal)).background).toBe('rgba(0, 0, 0, 0)');
  expect((await lookOf(page.locator('#set-aside-calendar .air-datepicker-cell.-day-[data-date="31"][data-month="9"]'))).color).toBe(await token(page, '--text'));
  await expect(page.locator('#set-aside-calendar .air-datepicker-body--day-name').first()).toHaveText(/^mo$/i);
  const calendarBottom = (await cal.boundingBox())!;
  const time = (await page.locator('#set-aside-time').boundingBox())!;
  expect(time.y - (calendarBottom.y + calendarBottom.height)).toBeGreaterThanOrEqual(8);
});

// A pick of a moment, as the filter's date presets are, so it wears their pill, and the one chosen their look of a filter that is on.
test("the choices wear the date presets' pill, the one chosen filled as a preset that is on", async ({ app, page }) => {
  await app.boot(fixture);
  await openSetAside(page, one.title);
  await choice(page, /^Whenever$/).click();
  const chosen = await lookOf(choice(page, /^Whenever$/));
  const other = await lookOf(choice(page, /^Tomorrow/));
  expect(chosen.background).toBe(await token(page, '--active'));
  expect(other.background).not.toBe(chosen.background);
  // The filter's date presets are in the page while its panel is shut, so their computed pill is there to hold these to.
  const pill = (el: Element): string[] => ((style) => [style.borderRadius, style.paddingTop, style.paddingLeft, style.fontSize])(getComputedStyle(el));
  expect(await choice(page, /^Tomorrow/).evaluate(pill)).toEqual(await page.locator('#date-presets button').first().evaluate(pill));
});

test("a prompt there takes it off, a scheduled task's turn and its tab's close do not", async ({ app, page }) => {
  const tick = { prompt: 'Reply with the single word tick.', recurring: true, cron: 'Every minute' };
  await app.boot({ ...fixture, setAside: { [one.id]: { due: null, at: 1 } }, scheduledWhenStopped: { [one.id]: [tick] } });
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

test('finishing it takes the mark off, and Undo gives it back as it was', async ({ app, page }) => {
  await app.boot({ ...fixture, setAside: { [one.id]: { due: null, at: 7 } } });
  await (await menuItem(page, one.title, 'Finished')).click();
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.setAside)).toEqual({});
  await toastButton(page, 'Undo').click();
  await expect(tab(page, one.title)).toHaveCount(1);
  for (const mark of marks(page)) await expect(mark).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.setAside)).toEqual({ [one.id]: { due: null, at: 7 } });
});

test('a day that came while the app was closed makes the session need you at launch, with the reminder, the bookmark gone', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  const due = new Date(2026, 9, 28, 9, 0).getTime();
  await app.boot({ ...fixture, setAside: { [one.id]: { due, at: 1 } } });
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(row(page, one.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — reminder for Wed 28 Oct, 09:00');
  for (const mark of marks(page)) await expect(mark).toBeHidden();
  expect(await app.calls('setAsideCameDue')).toHaveLength(1);
});

// The reminder is a type a file of yours can switch off (decided 2026-11-06): the day still takes the bookmark off, and nothing needs you for it.
test('with the reminder switched off, a day that came takes the bookmark off and marks nothing', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  const due = new Date(2026, 9, 28, 9, 0).getTime();
  await app.boot({ ...fixture, setAside: { [one.id]: { due, at: 1 } }, needsYouTypes: switchedOff('app.reminder') });
  for (const mark of marks(page)) await expect(mark).toBeHidden();
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('setAsideCameDue')).toEqual([[expect.any(Number), false]]);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou)).toEqual({});
});

// Each when it comes, not at an hourly look: the timer is set for the soonest, then for the next.
test('a moment that comes while the app runs shows when it comes, the next one after it in turn', async ({ app, page }) => {
  await page.clock.install({ time: new Date(2026, 9, 30, 8, 0) });
  await app.boot({ ...fixture, setAside: { [two.id]: { due: new Date(2026, 9, 30, 8, 10).getTime(), at: 1 }, [one.id]: { due: new Date(2026, 9, 30, 8, 40).getTime(), at: 1 } } });
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
  await page.clock.fastForward('11:00');
  await expect(row(page, two.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(row(page, two.title).locator('.set-aside-mark')).toBeHidden();
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
  await page.clock.fastForward('30:00');
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
});

test('a needs-you mark from before the set-aside mark is muted, read-looking and counted nowhere, and keeps its reason for when the day comes', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.was-running', at: 5, how: 'quit' }] }, setAside: { [one.id]: { due: null, at: 10 } } });
  const dot = row(page, one.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bneeds\b.*\backed\b|\backed\b.*\bneeds\b/);
  await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit (read)');
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\backed\b/);
  await expect(switcherRollUp(page, 'demo')).not.toHaveClass(/\bneeds\b/);
});

// The dot shows the mark over idle, read-looking; the roll-ups follow the dot, so an idle session so set aside nudges nowhere, while claude asking still does.
test('a muted session that runs and is idle rolls up as read, and one whose claude asks still counts', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.was-running', at: 5, how: 'quit' }] }, setAside: { [one.id]: { due: null, at: 10 } } });
  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'idle', '', 'Stop');
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b.*\backed\b|\backed\b.*\bneeds\b/);
  await expect(switcherRollUp(page, 'demo')).not.toHaveClass(/\bidle\b|\bneeds\b/);

  await app.emit('onSessionStatus', one.id, 'waiting', '', 'PermissionRequest');
  await expect(switcherRollUp(page, 'demo')).toHaveClass(/\bwaiting\b/);
});

test('a day coming on a session that already needs you keeps its reason, and lights it up again', async ({ app, page }) => {
  await page.clock.setFixedTime(THURSDAY);
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.was-running', at: 5, how: 'quit' }] }, setAside: { [one.id]: { due: new Date(2026, 9, 28).getTime(), at: 10 } } });
  const dot = row(page, one.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bneeds\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit');
});

test('a needs-you mark after the set-aside mark is news, shown and counted in full', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.was-running', at: 20, how: 'quit' }] }, setAside: { [one.id]: { due: null, at: 10 } } });
  const dot = row(page, one.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bneeds\b/);
  await expect(dot).not.toHaveClass(/\backed\b/);
  await expect(switcherRollUp(page, 'demo')).toHaveClass(/\bneeds\b/);
});

test('a prompt there settles both marks', async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.was-running', at: 5, how: 'quit' }] }, setAside: { [one.id]: { due: null, at: 10 } } });
  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'UserPromptSubmit', undefined, 'carry on');
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
  await expect(row(page, one.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
  expect(await app.calls('clearNeedsYou')).toEqual([[one.id, 'prompt']]);
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
});

// Setting aside took over from pausing a tab, so pause and its force are gone from every menu, whatever the tab is doing (decided 2026-10-29).
test('no menu offers Pause or its force, on a cold tab, a running one or one whose claude is leaving', async ({ app, page }) => {
  await app.boot(fixture);
  const noPause = async (): Promise<void> => {
    await row(page, one.title).locator('.session-kebab').click();
    await expect(page.locator('.kebab-menu button.menu-row', { hasText: /^Set aside…$/ })).toBeVisible();
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
