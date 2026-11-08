import type { Locator, Page } from '@playwright/test';
import { PALETTE } from '../../../../../src/shared/looks';
import { session, settingsFileWith } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { pixels } from '../../../support/looks';
import { LAYOUT, here, railItem, withLayout } from '../../layout/layout';
import { row, stripRow, switcherRollUp, tab } from '../../../support/window';

// How each status, category and type is drawn is `looks` in settings.json, field by field over what it looks like and what it belongs to, the defaults being the dots as they were (decided 2026-11-06).
const one = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Marked session' });
const two = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Other session' });
const mark = { type: 'app.was-running' as const, at: 1, how: 'quit' as const };
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], needsYou: { [one.id]: [mark] }, history: { [one.id]: [], [two.id]: [] } };

/** The marked session's dot on each surface that draws one for it, then the roll-ups that carry it as a dot. */
const dots = (page: Page): Locator[] => [row(page, one.title).locator('.nudge'), tab(page, one.title).locator('.nudge'), stripRow(page, one.title).locator('.nudge'), page.locator('#strip-badge')];

/** The switcher's count for the marked session's project, which takes only the look's colour, as its text. */
const pill = (page: Page): Locator => switcherRollUp(page, 'demo');

/** A colour as the page computes it. */
const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

const fill = (dot: Locator): Promise<string> => dot.evaluate((el) => getComputedStyle(el).backgroundColor);
const ink = (dot: Locator): Promise<string> => dot.evaluate((el) => getComputedStyle(el).color);

test('with no looks set, a reason draws as the needs-you mauve, pulsing, on every surface', async ({ app, page }) => {
  await app.boot(fixture);
  for (const dot of dots(page)) {
    await expect(dot).toHaveClass(/\blook-app\.was-running\b/);
    expect(await fill(dot)).toBe(rgb(PALETTE.mauve));
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('pulse');
  }
  await expect(pill(page)).toHaveClass(/\blook-app\.was-running\b/);
  expect(await ink(pill(page))).toBe(rgb(PALETTE.mauve));
});

test('a reason of a type the needs-you files do not define draws in your needs-you look', async ({ app, page }) => {
  const unknown = { type: 'plugin.reviewed', at: 1 } as unknown as typeof mark;
  await app.boot({ ...fixture, needsYou: { [one.id]: [unknown] }, settings: settingsFileWith('settings.json', { looks: { 'needs-you': { colour: 'teal' } } }) });
  for (const dot of dots(page)) {
    await expect(dot).toHaveClass(/\bneeds\b/);
    expect(await fill(dot)).toBe(rgb(PALETTE.teal));
  }
  await expect(pill(page)).toHaveClass(/\bneeds\b/);
  expect(await ink(pill(page))).toBe(rgb(PALETTE.teal));
});

test("a colour set for a reason's category draws on its dot and every roll-up, and its type follows the category", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { looks: { reminders: { colour: 'peach' } } }) });
  for (const dot of dots(page)) {
    expect(await fill(dot)).toBe(rgb(PALETTE.peach));
    // Pulse is left to needs-you's look, which pulses.
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('pulse');
  }
  expect(await ink(pill(page))).toBe(rgb(PALETTE.peach));
});

test("a type that looks like idle draws as a still green dot, and its menu header's dot alike", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { looks: { 'app.was-running': { looksLike: 'idle' } } }) });
  for (const dot of dots(page)) {
    expect(await fill(dot)).toBe(rgb(PALETTE.green));
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  }
  expect(await ink(pill(page))).toBe(rgb(PALETTE.green));
  await row(page, one.title).locator('.session-kebab').click();
  expect(await fill(page.locator('.kebab-menu .menu-header .menu-header-line.dotted .nudge').first())).toBe(rgb(PALETTE.green));
});

test("an icon look draws the icon in the dot's place, its colour as a mask's fill, and moves nothing beside it", async ({ app, page }) => {
  await app.boot(fixture);
  const title = row(page, one.title).locator('.card-title');
  const tabLabel = tab(page, one.title).locator('.tab-label');
  const before = [await title.boundingBox(), await tabLabel.boundingBox()];
  await app.settingsOnDisk(settingsFileWith('settings.json', { looks: { 'app.was-running': { mark: 'check', colour: 'teal' } } }));
  for (const dot of dots(page)) {
    await expect.poll(() => dot.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe(rgb(PALETTE.teal));
    expect(await dot.evaluate((el) => getComputedStyle(el, '::before').maskImage)).toContain('data:image/svg+xml');
    expect(await fill(dot)).toBe('rgba(0, 0, 0, 0)');
  }
  // The count takes the look's colour and never its icon.
  expect(await ink(pill(page))).toBe(rgb(PALETTE.teal));
  expect(await pill(page).evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  for (const dot of [row(page, one.title).locator('.nudge'), tab(page, one.title).locator('.nudge')]) {
    expect(await dot.evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height])).toEqual([9, 9]);
  }
  // Teal is far greener than red, the dark background nearly even, so a pixel well greener than red is the icon's ink, at any point of the pulse.
  for (const dot of [row(page, one.title).locator('.nudge'), tab(page, one.title).locator('.nudge'), stripRow(page, one.title).locator('.nudge')]) {
    const box = (await dot.boundingBox())!;
    const ink = (await pixels(page, { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 })).flat().map(([r, g]) => g - r);
    expect(Math.max(...ink)).toBeGreaterThan(20);
  }
  expect([await title.boundingBox(), await tabLabel.boundingBox()]).toEqual(before);
});

test("a rail icon's corner draws a look as a plain dot of its colour, never its icon", async ({ app, page }) => {
  const layout = withLayout(LAYOUT, { sidebar: { folded: true } });
  await app.boot({ ...layout, needsYou: { [here.id]: [mark] }, settings: settingsFileWith('settings.json', { looks: { 'app.was-running': { mark: 'check', colour: 'teal' } } }) });
  const corner = railItem(page, /^Sessions/).locator('.nudge');
  await expect(corner).toHaveClass(/\blook-app\.was-running\b/);
  expect(await fill(corner)).toBe(rgb(PALETTE.teal));
  expect(await corner.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
});

test("an attention toast's edge takes its dot's look's colour", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { looks: { waiting: { colour: 'sky' } } }) });
  // Both live, the second on show, so the first waiting is out of sight and says so in a toast.
  for (const [i, s] of [one, two].entries()) {
    await row(page, s.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(i + 1);
    expect(await app.emit('onTerminalData', i + 1, 'claude is here')).toBe(1);
  }
  await app.emit('onSessionStatus', one.id, 'waiting', '', 'Notification');
  const toast = page.locator('#notifications .notif');
  await expect(toast).toHaveCount(1);
  expect(await toast.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(rgb(PALETTE.sky));
  expect(await fill(toast.locator('.nudge'))).toBe(rgb(PALETTE.sky));
});

test('looks with a mistake are not used, and Settings says why', async ({ app, page }) => {
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { looks: { reminders: { colour: 'peach' }, merged: { colour: 'red' } } }) });
  expect(await fill(row(page, one.title).locator('.nudge'))).toBe(rgb(PALETTE.mauve));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).locator('#settings-dots-problems')).toHaveText('The looks in settings.json are not used: "merged" is neither a status, "needs-you", a category nor a type.');
});
