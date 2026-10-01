import type { Locator, Page } from '@playwright/test';

/**
 * Where the checks find things in the window, each in one place: a class the window renames is renamed here, rather than in every check that looked for it.
 * A check finds through these; what it then asks of what it found (a class, a text, a count) is the check's own.
 */

/** Every row of the session list. */
export const rows = (page: Page): Locator => page.locator('#sessions .session');

/** The session list's row whose text holds `title`. */
export const row = (page: Page, title: string): Locator => rows(page).filter({ hasText: title });

/** Every tab in the tab bar. */
export const tabs = (page: Page): Locator => page.locator('#tabbar .tab');

/** The tab whose label holds `title`. */
export const tab = (page: Page, title: string): Locator => tabs(page).filter({ has: page.locator('.tab-label', { hasText: title }) });

/** Every tab's label, in the bar's order. */
export const tabLabels = (page: Page): Locator => page.locator('#tabbar .tab-label');

/** The tab label that holds `title`: what a click on a tab presses. */
export const tabLabel = (page: Page, title: string): Locator => tabLabels(page).filter({ hasText: title });
