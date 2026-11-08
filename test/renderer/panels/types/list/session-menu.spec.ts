import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { row as sessionRow, tab } from '../../../support/window';
import { bootList, row, type PrintedList } from './list';

// A row naming a session carries that session's menu behind its ⋮, the row's own actions beyond its buttons under the menu's header (docs/panel-types.md § An item, docs/architecture.md § A session's menu holds everything about it).

const OTHER = `${HOME}/projects/other`;
// In another project than the one on show, so going to it can be told from opening its tab where you are.
const named = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'Fix the importer', cwd: OTHER, repoRoot: OTHER });
const here = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Here' });
const GONE = '00000000-0000-4000-8000-0000000000ff';
const more = { sessions: [here, named], projectOrder: [PROJECT, OTHER], activeProject: PROJECT, history: { [here.id]: [], [named.id]: [] } };
const research = { label: 'Research', session: { prompt: '/research sc-1' } };
const autopilot = { label: 'Autopilot', session: { prompt: '/autopilot sc-1' } };

/** One row printed with `over`, its text saying what it is for. */
const one = (over: Record<string, unknown>): PrintedList => ({ version: 1, sections: [{ items: [{ key: 'r', text: 'The row', ...over }] }] });

const kebab = (page: Page): Locator => row(page, 'The row').locator('.list-kebab');
const menuItems = (page: Page): Locator => page.locator('.kebab-menu:not(.submenu) button.menu-row');

test("a row naming a session has the session's menu behind its ⋮, whose Open goes to the session in its own project", async ({ app, page }) => {
  await bootList(app, page, one({ session: named.id }), { more });
  await expect(kebab(page)).toHaveAttribute('aria-label', 'Session options');
  await kebab(page).click();
  await expect(page.locator('.kebab-menu').first()).toContainText(named.title);
  await expect(menuItems(page).filter({ hasText: /^Show in list$/ })).toHaveCount(1);
  await expect(menuItems(page).filter({ hasText: /^Select…$/ })).toHaveCount(0);
  await menuItems(page).filter({ hasText: /^Open$/ }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(named.id);
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(tab(page, named.title)).toHaveClass(/\bactive\b/);
});

test("Show in list in a row's session menu widens the list to All when the session is in another project, leaving the project's tabs as they are", async ({ app, page }) => {
  await bootList(app, page, one({ session: named.id }), { more });
  await expect(page.locator('#switcher-name')).toHaveText('demo');
  await kebab(page).click();
  await menuItems(page).filter({ hasText: /^Show in list$/ }).click();
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(sessionRow(page, named.title)).toBeVisible();
  expect(await app.calls('startTerminal')).toHaveLength(0);
});

test("a row naming a session puts its actions beyond its buttons in the session's menu, before the session's own items", async ({ app, page }) => {
  await bootList(app, page, one({ session: named.id, actions: [research, autopilot] }), { more });
  await expect(row(page, 'The row').locator('.list-action')).toHaveText(['Research']);
  await kebab(page).click();
  await expect(menuItems(page).first()).toHaveText('Autopilot');
  await expect(menuItems(page).nth(1)).toHaveText('Open');
});

test("a row naming a session the app does not have keeps its own actions behind the ⋮", async ({ app, page }) => {
  await bootList(app, page, one({ session: GONE, actions: [research, autopilot] }), { more });
  await expect(kebab(page)).toHaveAttribute('aria-label', 'More actions');
  await kebab(page).click();
  await expect(menuItems(page)).toHaveText(['Autopilot']);
});

test('a row naming a session the app does not have, with no actions beyond its buttons, has no ⋮', async ({ app, page }) => {
  await bootList(app, page, one({ session: GONE }), { more });
  await expect(row(page, 'The row')).toHaveCount(1);
  await expect(kebab(page)).toHaveCount(0);
});
