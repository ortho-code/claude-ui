import type { Locator, Page } from '@playwright/test';
import { PROJECT } from '../../../support/fixture';
import { expect, test, type App } from '../../../support/harness';
import { panelTab, panelTabAdd, panelTabLabels, panelTabs } from '../../../support/window';
import { withLayout } from '../../layout/layout';

// Ending a shell with a command running in it asks first, naming the command, which main reads off its terminal at the press (docs/architecture.md § The `terminal` type).
const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '420px', panels: [{ id: 'shell', type: 'terminal', title: 'Shell' }] },
    ],
  },
});

/** Start `command` in the shell whose terminal is `id`, as far as main can tell. */
const running = (page: Page, id: number, command: string): Promise<void> => page.evaluate(([at, name]) => void (window.__claudeUiFixture.foreground[at] = name), [id, command] as const);

const kills = async (app: App): Promise<unknown[]> => (await app.calls('killTerminal')).map(([id]) => id);

const question = (page: Page): Locator => page.locator('#confirm-dialog');

/** The panel's first shell, started by itself, is terminal 1. */
async function bootWithShell(app: App, page: Page): Promise<void> {
  await app.boot(layout);
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
}

test('closing a shell with a command running asks first, naming it; Cancel keeps it, Close ends it', async ({ app, page }) => {
  await bootWithShell(app, page);
  await running(page, 1, 'npm run dev');

  await panelTab(page, 'demo').locator('.tab-close').click();
  await expect(question(page)).toBeVisible();
  await expect(question(page).locator('#confirm-message')).toHaveText('Close this terminal?');
  await expect(question(page).locator('#confirm-detail')).toHaveText('“npm run dev” is still running in “demo”. Closing the terminal ends it.');
  await expect(question(page).locator('#confirm-ok')).toHaveText('Close terminal');
  await question(page).locator('#confirm-cancel').click();
  await expect(question(page)).toBeHidden();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  expect(await kills(app)).toEqual([]);

  await panelTab(page, 'demo').locator('.tab-close').click();
  await question(page).locator('#confirm-ok').click();
  await expect(panelTabs(page)).toHaveCount(0);
  await expect.poll(() => kills(app)).toEqual([1]);
});

test('closing a shell with nothing running in it asks nothing', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTab(page, 'demo').locator('.tab-close').click();
  await expect(panelTabs(page)).toHaveCount(0);
  await expect(question(page)).toBeHidden();
  expect(await kills(app)).toEqual([1]);
});

test('a middle-click on a busy shell\'s tab asks as its button does', async ({ app, page }) => {
  await bootWithShell(app, page);
  await running(page, 1, 'sleep');
  await panelTab(page, 'demo').locator('.tab-label').click({ button: 'middle' });
  await expect(question(page).locator('#confirm-detail')).toHaveText('“sleep” is still running in “demo”. Closing the terminal ends it.');
  await question(page).locator('#confirm-cancel').click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
});

// A middle-click leaves the keyboard where it was, often in the terminal, which would take Esc and send it to the command.
test('the question takes the keyboard, on Cancel, so Esc answers it, though the press left the keys in the terminal', async ({ app, page }) => {
  await bootWithShell(app, page);
  await running(page, 1, 'vi');
  await page.locator('.panel-terminal:visible').click();
  await expect(page.locator('.panel-terminal:visible textarea')).toBeFocused();
  await panelTab(page, 'demo').locator('.tab-label').click({ button: 'middle' });
  await expect(question(page)).toBeVisible();
  await expect(question(page).locator('#confirm-cancel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question(page)).toBeHidden();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  expect(await kills(app)).toEqual([]);
});

test('a second close pressed while the first is being asked ends nothing, and the answer is the first one\'s alone', async ({ app, page }) => {
  await bootWithShell(app, page);
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'demo 2']);
  await running(page, 1, 'sleep');
  await running(page, 2, 'npm run dev');
  await app.hold('terminalForeground');
  await panelTab(page, 'demo').locator('.tab-close').click();
  await panelTab(page, 'demo 2').locator('.tab-close').click();
  await app.release('terminalForeground');
  await expect(question(page).locator('#confirm-detail')).toHaveText('“sleep” is still running in “demo”. Closing the terminal ends it.');
  await question(page).locator('#confirm-ok').click();
  await expect(panelTabLabels(page)).toHaveText(['demo 2']);
  expect(await kills(app)).toEqual([1]);
});

test('Restart here on a busy shell asks first, and Cancel leaves it running', async ({ app, page }) => {
  await bootWithShell(app, page);
  await running(page, 1, 'vi');
  await panelTab(page, 'demo').locator('.tab-kebab').click();
  await page.locator('.kebab-menu .menu-row', { hasText: 'Restart here' }).click();
  await expect(question(page).locator('#confirm-message')).toHaveText('Restart this terminal?');
  await expect(question(page).locator('#confirm-detail')).toHaveText('“vi” is still running in “demo”. Restarting the terminal ends it.');
  await question(page).locator('#confirm-cancel').click();
  expect(await kills(app)).toEqual([]);
  expect(await app.calls('startShell')).toHaveLength(1);

  await panelTab(page, 'demo').locator('.tab-kebab').click();
  await page.locator('.kebab-menu .menu-row', { hasText: 'Restart here' }).click();
  await question(page).locator('#confirm-ok').click();
  await expect.poll(() => kills(app)).toEqual([1]);
  await expect.poll(async () => (await app.calls('startShell')).map(([cwd]) => cwd)).toEqual([PROJECT, PROJECT]);
});
