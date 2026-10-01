import type { Locator, Page } from '@playwright/test';

/**
 * Where the checks find things in the window, each in one place: a class the window renames is renamed here, rather than in every check that looked for it.
 * A check finds through these; what it then asks of what it found (a class, a text, a count) is the check's own.
 */

/** Every row of the session list. */
export const rows = (page: Page): Locator => page.locator('#sessions .session');

/** The session list's row whose text holds `title`. */
export const row = (page: Page, title: string): Locator => rows(page).filter({ hasText: title });

/** The titles of the rows inside `scope`, such as one group, in the list's order. */
export const titlesIn = (scope: Locator): Locator => scope.locator('.session .card-title');

/** Every row's title, in the list's order. */
export const titles = (page: Page): Locator => titlesIn(page.locator('#sessions'));

/** Every row's title, sorted: what the list shows, for a check that is not about the order. */
export const sortedTitles = async (page: Page): Promise<string[]> => (await titles(page).allTextContents()).sort();

/** Every project heading's name in the session list, in its order. */
export const headings = (page: Page): Locator => page.locator('#sessions .project > .section-heading .label');

/** The session list's section for the project named exactly `name`. */
export const project = (page: Page, name: string): Locator => page.locator('#sessions .project', { has: page.locator('> .section-heading .label', { hasText: new RegExp(`^${name}$`) }) });

/** That project's heading: what folds it, and what a jump to it lands on. */
export const projectHeading = (page: Page, name: string): Locator => project(page, name).locator('> .section-heading');

/** Every group heading's name in the session list, in its order. */
export const groupHeadings = (page: Page): Locator => page.locator('#sessions .group > .section-heading .label');

/** The session list's section for the group named exactly `name`. */
export const group = (page: Page, name: string): Locator => page.locator('#sessions .group', { has: page.locator('> .section-heading .label', { hasText: new RegExp(`^${name}$`) }) });

/** That group's heading. */
export const groupHeading = (page: Page, name: string): Locator => group(page, name).locator('> .section-heading');

/** Every entry in the project switcher, All first. */
export const switcherEntries = (page: Page): Locator => page.locator('.switcher-item');

/** The switcher's entry for the project named exactly `name`, or All. */
export const switcherEntry = (page: Page, name: string): Locator => switcherEntries(page).filter({ has: page.locator('.switcher-item-name', { hasText: new RegExp(`^${name}$`) }) });

/** Every switcher entry's name, in its order. */
export const switcherNames = (page: Page): Locator => switcherEntries(page).locator('.switcher-item-name');

/** Open the switcher and choose the project named exactly `name`, or All: the one step here that does rather than finds, since four checks took it in the same two lines. */
export async function chooseProject(page: Page, name: string): Promise<void> {
  await page.locator('#switcher-current').click();
  await switcherEntry(page, name).click();
}

/** Every tab in the tab bar. */
export const tabs = (page: Page): Locator => page.locator('#tabbar .tab');

/** The tab whose label holds `title`. */
export const tab = (page: Page, title: string): Locator => tabs(page).filter({ has: page.locator('.tab-label', { hasText: title }) });

/** Every tab's label, in the bar's order. */
export const tabLabels = (page: Page): Locator => page.locator('#tabbar .tab-label');

/** The tab label that holds `title`: what a click on a tab presses. */
export const tabLabel = (page: Page, title: string): Locator => tabLabels(page).filter({ hasText: title });
