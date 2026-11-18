import type { Locator, Page } from '@playwright/test';
import { PROJECT, session, settingsFileWith } from '../support/fixture';
import { expect, test } from '../support/harness';
import { projectHeading, row } from '../support/window';
import { openSettings } from '../support/settings';

// A menu leaves out what cannot be done now, unless `unavailableItems` says "dim", which shows it dimmed with why on its hover (docs/architecture/claude.md § A session's menu holds everything about it).
// A session nothing marked stands in: Clear needs you and Clear set aside cannot be done on it, and a project with one group has nowhere to jump.
const one = session({ title: 'Nothing marked' });
const oneGroup = { groups: [{ id: 'g-only', name: 'Only', repoRoot: PROJECT }], groupOf: { [one.id]: 'g-only' } };

const menu = (page: Page): Locator => page.locator('.kebab-menu:not(.submenu) > .menu-list');
const item = (page: Page, label: string): Locator => menu(page).locator('button.menu-row').filter({ hasText: new RegExp(`^${label}$`) });

/** The open menu's header, rows and rules in order, the header as "header" and a rule as "─". */
const shape = (page: Page): Promise<string[]> =>
  menu(page).evaluate((list) => [...list.children].map((child) => (child.classList.contains('menu-header') ? 'header' : child.classList.contains('menu-separator') ? '─' : child.textContent)));

/** No rule at either end of the menu, and never two together; a rule under the header parts it from the items. */
function rulesBetweenItems(lines: string[]): boolean {
  return lines[0] !== '─' && lines.at(-1) !== '─' && lines.every((line, at) => line !== '─' || lines[at - 1] !== '─');
}

test("a session's menu leaves out what cannot be done now", async ({ app, page }) => {
  await app.boot({ sessions: [one] });
  await row(page, one.title).locator('.session-kebab').click();
  await expect(item(page, 'Open')).toBeVisible();
  await expect(item(page, 'Clear needs you')).toHaveCount(0);
  await expect(item(page, 'Clear set aside')).toHaveCount(0);
});

test('a menu whose last group is all unavailable drops that group and the rule before it', async ({ app, page }) => {
  await app.boot({ sessions: [one], groupState: oneGroup });
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await expect(item(page, 'Copy path')).toBeVisible();
  await expect(item(page, 'Jump to group')).toHaveCount(0);
  const lines = await shape(page);
  expect(lines.at(-1)).toBe('Copy path');
  expect(rulesBetweenItems(lines)).toBe(true);
});

test('with "dim", what cannot be done now is shown dimmed, saying why on its hover', async ({ app, page }) => {
  await app.boot({ sessions: [one], settings: settingsFileWith('settings.json', { unavailableItems: 'dim' }) });
  await row(page, one.title).locator('.session-kebab').click();
  await expect(item(page, 'Clear needs you')).toHaveAttribute('aria-disabled', 'true');
  await expect(item(page, 'Clear needs you')).toHaveAttribute('data-tooltip', 'Not marked as needing you');
});

test('Settings switches it, and a menu opened after the save follows', async ({ app, page }) => {
  await app.boot({ sessions: [one] });
  const dialog = await openSettings(page, 'Appearance');
  const field = dialog.getByLabel('Menu items that cannot be done now');
  await expect(field).toHaveValue('hide');
  await field.selectOption('dim');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await row(page, one.title).locator('.session-kebab').click();
  await expect(item(page, 'Clear needs you')).toHaveAttribute('aria-disabled', 'true');
});
