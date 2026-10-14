import type { Locator, Page } from '@playwright/test';
import { type App, expect, test } from '../../../support/harness';
import { clickAcross } from '../../../support/press';
import { runs } from '../../layout/layout';
import { bootList, print, row, type PrintedList } from './list';

// Where a row's actions go (docs/panel-types.md § The list, § An item): the first as many as the list's `buttons` says, 1 without one, as buttons, and the rest in a menu behind a ⋮ last on the row.

const research = { label: 'Research', session: { prompt: '/research sc-1' } };
const autopilot = { label: 'Autopilot', session: { prompt: '/autopilot sc-1' } };

/** One story row offering `actions`, under a list that says `buttons` when given, its text saying which run printed it. */
const printed = (actions: unknown[], buttons?: number, run = 1): PrintedList => ({
  version: 1,
  ...(buttons === undefined ? {} : { buttons }),
  sections: [{ items: [{ key: 'sc-1', text: `Fix the importer, run ${run}`, actions }] }],
});

const story = (page: Page): Locator => row(page, 'Fix the importer');
/** That the row shows what run `run` printed, so a check knows the list was drawn again. */
const drawnBy = (page: Page, run: number): Promise<void> => expect(story(page).locator('.card-title')).toHaveText(`Fix the importer, run ${run}`);
const kebab = (page: Page): Locator => story(page).locator('.list-kebab');
const menuItems = (page: Page): Locator => page.locator('.kebab-menu .menu-row');

/** Let the panel run again, and print `list` when what this returns is called. */
async function rerun(app: App, page: Page, list: PrintedList): Promise<() => Promise<void>> {
  const before = (await runs(app, 'changes')).length;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(async () => (await runs(app, 'changes')).length).toBe(before + 1);
  return () => print(app, before, list);
}

test("a row with two actions shows the first as a button and the second in the menu of a ⋮ last on the row, which asks for that action's session", async ({ app, page }) => {
  await bootList(app, page, printed([research, autopilot]));
  await expect(story(page).locator('.list-action')).toHaveText(['Research']);
  expect(await story(page).evaluate((el) => el.lastElementChild?.classList.contains('list-kebab'))).toBe(true);
  await kebab(page).click();
  await expect(menuItems(page)).toHaveText(['Autopilot']);
  await menuItems(page).click();
  await expect(page.locator('#session-overlay')).toBeVisible();
  await expect(page.locator('#session-prompt')).toHaveValue('/autopilot sc-1');
});

test("the list's buttons say how many show as buttons: 0 puts every action in the menu, 2 shows both and no ⋮", async ({ app, page }) => {
  await bootList(app, page, printed([research, autopilot], 0));
  await expect(story(page).locator('.list-action')).toHaveCount(0);
  await kebab(page).click();
  await expect(menuItems(page)).toHaveText(['Research', 'Autopilot']);
  // Shut again by its own trigger, as a second press on any kebab does.
  await kebab(page).click();
  await expect(menuItems(page)).toHaveCount(0);

  await (await rerun(app, page, printed([research, autopilot], 2)))();
  await expect(story(page).locator('.list-action')).toHaveText(['Research', 'Autopilot']);
  await expect(kebab(page)).toHaveCount(0);
});

test('a row with one action shows it as a button, with no ⋮', async ({ app, page }) => {
  await bootList(app, page, printed([research]));
  await expect(story(page).locator('.list-action')).toHaveText(['Research']);
  await expect(kebab(page)).toHaveCount(0);
});

test('an item of a menu opened before a run took its action away asks for nothing', async ({ app, page }) => {
  await bootList(app, page, printed([research, autopilot]));
  // Asked for first, since pressing Refresh is a click outside the menu, which shuts it.
  const ended = await rerun(app, page, printed([research, { ...autopilot, session: { prompt: '/autopilot sc-1 --again' } }], undefined, 2));
  await kebab(page).click();
  await expect(menuItems(page)).toHaveText(['Autopilot']);
  await ended();
  await drawnBy(page, 2);
  // Asking reads the panel's data in the press itself, so the reads say whether it asked.
  const reads = (await app.calls('getPanelData')).length;
  await menuItems(page).click();
  expect(await app.calls('getPanelData')).toHaveLength(reads);
  await expect(page.locator('#session-overlay')).toBeHidden();
});

test('a press on the ⋮ still opens its menu when the list is drawn again between the press and its release', async ({ app, page }) => {
  await bootList(app, page, printed([research, autopilot]));
  const ended = await rerun(app, page, printed([research, autopilot], undefined, 2));
  await clickAcross(page, kebab(page), async () => {
    await ended();
    await drawnBy(page, 2);
  });
  await expect(menuItems(page)).toHaveText(['Autopilot']);
});
