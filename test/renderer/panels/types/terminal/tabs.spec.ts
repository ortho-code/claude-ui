import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT } from '../../../support/fixture';
import { expect, test, type App } from '../../../support/harness';
import { chooseProject, panelTab, panelTabAdd, panelTabLabels, panelTabRows, panelTabs, tab, tabLabel } from '../../../support/window';
import { here, railItem, withLayout } from '../../layout/layout';

// A terminal panel holds shells as tabs in its header, by project (docs/architecture.md § The `terminal` type): only you make one, a switch never ends one, and a project with none shows a line instead.
const NOTES = `${HOME}/notes`;

/** The shell first in a railed group, so it is on show and its icon is on screen, with `options` on its entry. */
const layout = (options?: Record<string, unknown>): ReturnType<typeof withLayout> =>
  withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        {
          id: 'right',
          size: '420px',
          panels: [
            { id: 'shell', type: 'terminal', title: 'Shell', ...(options ? { options } : {}) },
            { id: 'status', type: 'command', title: 'Status', options: { command: 'git status --short' } },
          ],
        },
      ],
    },
  });

/** The folder of every shell started so far, in order. */
const starts = async (app: App): Promise<unknown[]> => (await app.calls('startShell')).map(([cwd]) => cwd);

/** The id of every terminal ended so far, in order. */
const kills = async (app: App): Promise<unknown[]> => (await app.calls('killTerminal')).map(([id]) => id);

/** The line in a shell's place when there is none. */
const line = (page: Page): Locator => page.locator('.panel-body .pane-placeholder:visible');

/** Boot, and make the project's first shell with `+`: terminal 1, named "demo". */
async function bootWithShell(app: App, page: Page, fixture: Parameters<App['boot']>[0] = layout()): Promise<void> {
  await app.boot(fixture);
  await expect(line(page)).toContainText('No terminal in demo.');
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
}

test('a project with no shell shows a line and starts none; + makes one, a tab named after its folder in place of the title, counted on the rail', async ({ app, page }) => {
  await app.boot(layout());
  await expect(line(page)).toContainText('No terminal in demo.');
  await expect(panelTabs(page)).toHaveCount(0);
  expect(await starts(app)).toEqual([]);

  await panelTabAdd(page).click();
  await expect.poll(() => starts(app)).toEqual([PROJECT]);
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect(page.locator('.panel-header.with-tabs .panel-title')).toHaveCount(0);
  await expect(railItem(page, /^Shell · 1$/)).toBeVisible();
  await expect(page.locator('.panel-terminal:visible textarea:focus')).toHaveCount(1);
});

test('the header with tabs stands as tall as a header without them', async ({ app, page }) => {
  await bootWithShell(app, page);
  const withTabs = (await page.locator('.panel-header.with-tabs').boundingBox())!.height;
  await railItem(page, /^Status/).click();
  const without = (await page.locator('.panel-header:visible').boundingBox())!.height;
  expect(withTabs).toBe(without);
});

test('+ opens another shell in the project, numbered after the first, on show and with the keys', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTabAdd(page).click();
  await expect.poll(() => starts(app)).toEqual([PROJECT, PROJECT]);
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);
  await expect(panelTab(page, 'demo 2')).toHaveClass(/\bactive\b/);
  await expect(railItem(page, /^Shell · 2$/)).toBeVisible();
  await expect(page.locator('.panel-terminal:visible textarea:focus')).toHaveCount(1);
});

test('a project switch shows that project\'s shells, makes none, and leaves the others running', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);

  await chooseProject(page, 'other');
  await expect(line(page)).toContainText('No terminal in other.');
  await expect(panelTabs(page)).toHaveCount(0);

  await chooseProject(page, 'demo');
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);
  // The one on show is the one you left on show there.
  await expect(panelTab(page, 'demo 2')).toHaveClass(/\bactive\b/);
  expect(await starts(app)).toEqual([PROJECT, PROJECT]);
  expect(await kills(app)).toEqual([]);
});

test('showing the panel again makes no shell either', async ({ app, page }) => {
  await app.boot(layout());
  await expect(line(page)).toContainText('No terminal in demo.');
  await railItem(page, /^Status/).click();
  await railItem(page, /^Shell/).click();
  await expect(line(page)).toContainText('No terminal in demo.');
  expect(await starts(app)).toEqual([]);
});

test('All shows every project\'s shells, a row each led by its name', async ({ app, page }) => {
  await bootWithShell(app, page);
  await chooseProject(page, 'other');
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['other']);
  await chooseProject(page, 'All');
  await expect(panelTabRows(page)).toHaveCount(2);
  await expect(panelTabRows(page).locator('.tab-project-label')).toHaveText(['demo', 'other']);
  await expect(panelTabLabels(page)).toHaveText(['demo', 'other']);
});

test('with nowhere to start a shell, + says why and starts none', async ({ app, page }) => {
  await bootWithShell(app, page);
  // All with nothing selected: no project to file a shell under, and no folder to start it in.
  await chooseProject(page, 'All');
  await expect(panelTabAdd(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(panelTabAdd(page)).toHaveAttribute('data-tooltip', 'Pick a project to run this in.');
  // Pressed anyway: Playwright would otherwise wait for a control that says it cannot act.
  await panelTabAdd(page).click({ force: true });
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  expect(await starts(app)).toHaveLength(1);
});

test('closing a shell ends it and shows the next; closing the last leaves the line, which a switch away and back keeps', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);

  await panelTab(page, 'demo 2').locator('.tab-close').click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect(panelTab(page, 'demo')).toHaveClass(/\bactive\b/);
  expect(await kills(app)).toEqual([2]);

  await panelTab(page, 'demo').locator('.tab-close').click();
  await expect(panelTabs(page)).toHaveCount(0);
  await expect(line(page)).toContainText('No terminal in demo.');
  await expect.poll(() => kills(app)).toEqual([2, 1]);

  await chooseProject(page, 'other');
  await chooseProject(page, 'demo');
  await expect(line(page)).toContainText('No terminal in demo.');
  expect(await starts(app)).toHaveLength(2);
});

test('a key on the line where there is no shell starts one', async ({ app, page }) => {
  await app.boot(layout());
  await expect(line(page)).toContainText('No terminal in demo.');
  // Focused rather than clicked: the line's middle is its New terminal button, which a click would press.
  await line(page).focus();
  await page.keyboard.press('a');
  await expect.poll(() => starts(app)).toEqual([PROJECT]);
  await expect(panelTabLabels(page)).toHaveText(['demo']);
});

test('keys typed on the line while its shell is being made make that one shell', async ({ app, page }) => {
  // A relative `cwd`, so making a shell asks main about its folder, which the check holds.
  await app.boot(layout({ cwd: '.' }));
  await expect(line(page)).toContainText('No terminal in demo.');
  await app.hold('checkPath');
  // Focused rather than clicked: the line's middle is its New terminal button, which a click would press.
  await line(page).focus();
  await page.keyboard.type('ls');
  await app.release('checkPath');
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  // A shell asked for after them all is the second, so no key made one of its own meanwhile.
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);
  expect(await starts(app)).toEqual([PROJECT, PROJECT]);
});

test('a shell that exits leaves its tab unfilled, and a key in it starts a new one there', async ({ app, page }) => {
  await bootWithShell(app, page);
  await expect.poll(() => app.emit('onTerminalExit', 1, 0)).toBe(1);
  await expect(panelTab(page, 'demo')).toHaveClass(/\bcold\b/);
  await page.locator('.panel-terminal:visible').click();
  await page.keyboard.press('a');
  await expect.poll(() => starts(app)).toEqual([PROJECT, PROJECT]);
  await expect(panelTab(page, 'demo')).not.toHaveClass(/\bcold\b/);
});

test('a double-click on a tab renames its shell through the name dialog', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTab(page, 'demo').locator('.tab-label').dblclick();
  await page.locator('#rename-input').fill('build');
  await page.locator('#rename-ok').click();
  await expect(panelTabLabels(page)).toHaveText(['build']);
});

test('Restart here, in a tab\'s menu, ends its shell and starts one in the tab', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTab(page, 'demo').locator('.tab-kebab').click();
  await page.locator('.kebab-menu .menu-row', { hasText: 'Restart here' }).click();
  await expect.poll(() => kills(app)).toEqual([1]);
  await expect.poll(() => starts(app)).toEqual([PROJECT, PROJECT]);
  await expect(panelTabLabels(page)).toHaveText(['demo']);
});

test('a tab dragged before another moves there', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);
  const from = (await panelTab(page, 'demo 2').boundingBox())!;
  const to = (await panelTab(page, 'demo').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(panelTabLabels(page)).toHaveText(['demo 2', 'demo']);
});

test('a shell asked for is filed where it was asked, though another project is on show by the time its folder is checked', async ({ app, page }) => {
  // A relative `cwd`, so making a shell asks main about its folder, which the check holds.
  await app.boot(layout({ cwd: '.' }));
  await expect(line(page)).toContainText('No terminal in demo.');
  await app.hold('checkPath');
  await panelTabAdd(page).click();
  await chooseProject(page, 'other');
  await app.release('checkPath');

  await expect.poll(() => starts(app)).toEqual([PROJECT]);
  await expect(line(page)).toContainText('No terminal in other.');
  await chooseProject(page, 'demo');
  await expect(panelTabLabels(page)).toHaveText(['demo']);
});

test('Restart here while the shell is still starting leaves one shell, handing the overtaken one back', async ({ app, page }) => {
  await bootWithShell(app, page);
  await app.hold('startShell');
  await panelTabAdd(page).click();
  await expect.poll(() => starts(app)).toHaveLength(2);
  await panelTab(page, 'demo 2').locator('.tab-kebab').click();
  await page.locator('.kebab-menu .menu-row', { hasText: 'Restart here' }).click();
  await expect.poll(() => starts(app)).toHaveLength(3);
  await app.release('startShell');
  // The first shell is 1; the overtaken start was answered 2, and the restart 3.
  await expect.poll(() => kills(app)).toEqual([2]);
  await expect(panelTab(page, 'demo 2')).not.toHaveClass(/\bcold\b/);
});

test('a drag of a panel tab that the tab bar ends by taking its own row away leaves the tabs drawing', async ({ app, page }) => {
  await app.boot({ ...layout(), openSessions: [here.id], history: { [here.id]: [] } });
  // The claude tab starts first, so its terminal is 1, and the shells are 2 and 3.
  await tabLabel(page, here.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await panelTabAdd(page).click();
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);
  // Past the moment in which an exit reads as a failed start, so the exit below closes the claude tab, and its row in the bar goes with its Sortable.
  await page.clock.setSystemTime(Date.now() + 60_000);

  const from = (await panelTab(page, 'demo 2').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 30, from.y + from.height / 2, { steps: 6 });
  await app.emit('onTerminalExit', 1, 0);
  await expect(tab(page, here.title)).toHaveCount(0);
  await page.mouse.up();

  // The drag ended as any drag does, leaving nothing of itself behind, and the tabs draw again.
  await expect(page.locator('.tab-ghost')).toHaveCount(0);
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2', 'demo 3']);
});

test('a terminal pinned to a folder shows its shells in every project, and a switch starts no other', async ({ app, page }) => {
  await app.boot({ ...layout({ cwd: NOTES }), paths: { [NOTES]: 'directory' } });
  await expect(line(page)).toContainText('No terminal yet.');
  await panelTabAdd(page).click();
  await expect.poll(() => starts(app)).toEqual([NOTES]);
  await expect(panelTabLabels(page)).toHaveText(['notes']);
  await chooseProject(page, 'other');
  await expect(panelTabLabels(page)).toHaveText(['notes']);
  expect(await starts(app)).toEqual([NOTES]);
});
