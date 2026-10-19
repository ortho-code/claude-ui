import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../src/shared/defaults';
import { session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { row, stripRow, tab, tabLabel } from '../../../support/window';

// THE KEBAB IS COMPLETE; A BUTTON IS A SHORTCUT: every button, dot that is a control and mark that opens something on a session's row, its tab and its strip row has an item in that surface's menu, and so does a press on the row, on the strip row and on a stopped tab.
// Outside the rule, by decision: a running tab's own press, which only brings it on show; its drag to reorder, which places it rather than acting on the session; its right-click, which is its menu; and its middle-click, which is its button's press.
// Each visible button, dot that is a control, `.menu-badge` and `.note-badge` on a surface is found in the page rather than listed, in the state the fixture sets up, and must be in the table below, so one added without its item fails here, naming it; a click handler on any other element, or one on the surface itself, is not found.
// The kebab itself is the menu, so it is in no table.

/** A control, known by a class it carries, and the label of the item it is the shortcut to. */
type Shortcuts = [className: string, item: RegExp][];

const DOT: [string, RegExp] = ['nudge', /^Mark as (read|unread)$/];
const TAB_BUTTON = /^(Stop session|Force stop|Close tab)$/;

const ROW: Shortcuts = [
  ['pin', /^(Pin in list|Unpin)$/],
  DOT,
  ['note-badge', /^(Add|Edit) note…$/],
  ['sibling-badge', /^Siblings \(\d+\)$/],
  ['pr-badge', /^PRs \(\d+\)$/],
];
const ARCHIVED_ROW: Shortcuts = [
  ['unarchive-btn', /^Unarchive$/],
  ['delete-btn', /^Delete session…$/],
  ['note-badge', /^(Add|Edit) note…$/],
  ['sibling-badge', /^Siblings \(\d+\)$/],
  ['pr-badge', /^PRs \(\d+\)$/],
];
const TAB: Shortcuts = [['tab-close', TAB_BUTTON], DOT];
const STRIP: Shortcuts = [['strip-item-jump', /^Open$/], ['strip-item-stop', TAB_BUTTON], DOT];

/** What on a surface takes a press of its own: its buttons, its dot while that is a control, and the marks that open something. */
const CONTROLS = 'button:visible, .nudge.clickable:visible, .menu-badge:visible, .note-badge:visible';

const sibling = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Its sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000a1'] });
const full = session({
  id: '00000000-0000-4000-8000-0000000000a1',
  title: 'Has everything',
  isSibling: true,
  siblingIds: [sibling.id],
  prs: [{ repository: 'ScientaNL/demo', number: 1, url: 'https://github.com/ScientaNL/demo/pull/1' }],
});
const fixture = { sessions: [full, sibling], openSessions: [full.id], notes: { [full.id]: 'a note' }, history: { [full.id]: [] } };

/**
 * Every control on `surface` is one the table knows, and the item it names is in the menu `kebab` opens, available where the control is; and so is the item for a press on the surface itself, `press`, where it has one.
 * Every control the table lists is on the surface too, so the fixture keeps each of them in sight and none is checked by its absence.
 */
async function eachControlHasItsItem(page: Page, surface: Locator, kebab: Locator, shortcuts: Shortcuts, press?: RegExp): Promise<void> {
  const controls = await surface.locator(CONTROLS).all();
  const expected: { control: string; item: RegExp; available: boolean }[] = press ? [{ control: 'a press on the surface', item: press, available: true }] : [];
  for (const control of controls) {
    const classes = ((await control.getAttribute('class')) ?? '').split(/\s+/);
    if (classes.includes('kebab')) continue;
    const known = shortcuts.find(([className]) => classes.includes(className));
    expect(known, `a control on this surface with no item in its menu: ${await control.evaluate((el) => el.outerHTML.slice(0, 160))}`).toBeDefined();
    const unavailable = classes.includes('unavailable') || (await control.isDisabled());
    expected.push({ control: known![0], item: known![1], available: !unavailable });
  }
  for (const [className] of shortcuts) expect(expected.some(({ control }) => control === className), `${className} on the surface`).toBe(true);
  await kebab.click();
  for (const { control, item, available } of expected) {
    const found = page.locator('.kebab-menu:not(.submenu) button.menu-row').filter({ hasText: item });
    await expect(found, `the item for ${control}`).toHaveCount(1);
    if (available) await expect(found, `the item for ${control}, available as the control is`).not.toHaveClass(/\bunavailable\b/);
  }
  await kebab.click();
}

/** Started, as running puts a session in the strip, and waiting, one of the two states in which its dot is a control. */
async function running(app: App, page: Page): Promise<void> {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onSessionStatus', full.id, 'waiting', '', '')).toBe(1);
  await expect(row(page, full.title).locator('.nudge')).toHaveClass(/\bclickable\b/);
}

test("every control on a session's row is a shortcut to an item in its menu, and so is a press on the row", async ({ app, page }) => {
  await running(app, page);
  const surface = row(page, full.title);
  await eachControlHasItsItem(page, surface, surface.locator('.session-kebab'), ROW, /^Open$/);
});

test("every control on a session's tab is a shortcut to an item in its menu", async ({ app, page }) => {
  await running(app, page);
  const surface = tab(page, full.title);
  await eachControlHasItsItem(page, surface, surface.locator('.tab-kebab'), TAB);
});

test("a press on a cold tab, which starts it, is in its menu as Open", async ({ app, page }) => {
  await app.boot(fixture);
  await tab(page, full.title).locator('.tab-kebab').click();
  const open = page.locator('.kebab-menu:not(.submenu) button.menu-row').filter({ hasText: /^Open$/ });
  await expect(open).toHaveCount(1);
  await expect(open).not.toHaveClass(/\bunavailable\b/);
});

test("every control on a session's strip row is a shortcut to an item in its menu", async ({ app, page }) => {
  await running(app, page);
  const surface = stripRow(page, full.title);
  await eachControlHasItsItem(page, surface, surface.locator('.strip-item-kebab'), STRIP);
});

test("every control on an archived session's row is a shortcut to an item in its menu", async ({ app, page }) => {
  await app.boot({
    ...fixture,
    openSessions: [],
    archived: { [full.id]: Date.parse('2026-10-01T08:00:00.000Z') },
    uiState: { ...defaultUi(), filters: { ...defaultUi().filters, archived: true } },
  });
  const surface = row(page, full.title);
  await eachControlHasItsItem(page, surface, surface.locator('.session-kebab'), ARCHIVED_ROW);
});
