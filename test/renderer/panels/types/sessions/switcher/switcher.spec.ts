import type { Locator } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { clickAcross } from '../../../../support/press';
import { chooseProject, headings, switcherEntries, switcherEntry, switcherNames, tab, tabLabels } from '../../../../support/window';

// Selecting a project is a statement about what you are looking at, so every surface honours it (docs/architecture.md § UI conventions): the list, the tab bar, and the tab on show, which is the one you were last in there, selected and not started (§ Tab lifecycle).
const OTHER = `${HOME}/projects/other`;
const here = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Over here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const fixture = {
  sessions: [here, there],
  projectOrder: [PROJECT, OTHER],
  activeProject: null,
  openSessions: [here.id, there.id],
  activeSessionByProject: { [OTHER]: there.id },
  history: { [here.id]: [], [there.id]: [] },
};

test("selecting a project scopes the list and the tab bar to it and selects the tab you were last in there, without starting it; All undoes it", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(tabLabels(page)).toHaveText([here.title, there.title]);

  await chooseProject(page, 'other');
  await expect(page.locator('#switcher-popover')).toBeHidden();
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(headings(page)).toHaveText(['other']);
  await expect(tabLabels(page)).toHaveText([there.title]);
  await expect(tab(page, there.title)).toHaveClass(/\bactive\b/);
  await expect(page.locator('#term-placeholder')).toContainText(`“${there.title}” isn’t running.`);
  expect(await app.calls('startTerminal')).toEqual([]);
  expect((await app.calls('setActiveProject')).at(-1)).toEqual([OTHER]);

  await chooseProject(page, 'All');
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(tabLabels(page)).toHaveText([here.title, there.title]);
  expect((await app.calls('setActiveProject')).at(-1)).toEqual([null]);
});

test('the switcher lists every project with its count, whatever the list is filtered to', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [] });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(here.title);
  await expect(headings(page)).toHaveText(['demo']);

  await page.locator('#switcher-current').click();
  await expect(switcherNames(page)).toHaveText(['All', 'demo', 'other']);
  await expect(switcherEntries(page).locator('.switcher-item-count')).toHaveText(['2', '1', '1']);
});

test('a switcher with more projects than fit scrolls its list inside its 320px cap', async ({ app, page }) => {
  const many = Array.from({ length: 20 }, (_, n) => {
    const root = `${HOME}/projects/p${String(n).padStart(2, '0')}`;
    return session({ id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, title: `Session ${n}`, cwd: root, repoRoot: root });
  });
  await app.boot({ sessions: many, projectOrder: many.map((s) => s.repoRoot), activeProject: null });
  const popover = page.locator('#switcher-popover');
  const last = switcherEntries(page).last();
  const bottomOf = async (element: Locator): Promise<number> => {
    const box = await element.boundingBox();
    if (!box) throw new Error('not laid out');
    return box.y + box.height;
  };
  await page.locator('#switcher-current').click();
  await expect(switcherEntries(page)).toHaveCount(21);
  const box = await popover.boundingBox();
  expect(box?.height).toBe(320);
  expect(await bottomOf(last)).toBeGreaterThan(await bottomOf(popover));

  await switcherEntries(page).first().hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(async () => (await bottomOf(last)) <= (await bottomOf(popover))).toBe(true);
  await expect(popover).toBeVisible();
});

// The switcher is drawn again whenever any session's status changes, which can land between the press on an entry and its release, or under an entry reached with the keyboard: the entry stays where it is, so the choice still counts and the focus stays put.
test('a press on a switcher entry still counts, and a focused entry keeps the focus, when a status arrives', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [] });
  const status = (state: string) => async (): Promise<void> => {
    expect(await app.emit('onSessionStatus', here.id, state, '', '')).toBe(1);
    await expect(switcherEntry(page, 'demo').locator('.nudge')).toHaveClass(new RegExp(`\\b${state}\\b`));
  };
  await page.locator('#switcher-current').click();
  const other = switcherEntry(page, 'other');

  await other.focus();
  await status('busy')();
  await expect(other).toBeFocused();

  await clickAcross(page, other, status('idle'));
  await expect(page.locator('#switcher-name')).toHaveText('other');
});

test('the switcher shuts on its own button and on a click outside it, choosing nothing', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [] });
  const popover = page.locator('#switcher-popover');
  await page.locator('#switcher-current').click();
  await expect(popover).toBeVisible();
  await expect(page.locator('#switcher-current')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#switcher-current').click();
  await expect(popover).toBeHidden();

  await page.locator('#switcher-current').click();
  await expect(popover).toBeVisible();
  await page.locator('#term-placeholder').click();
  await expect(popover).toBeHidden();
  await expect(page.locator('#switcher-current')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#switcher-name')).toHaveText('All');
});
