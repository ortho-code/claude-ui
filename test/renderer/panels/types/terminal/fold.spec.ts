import type { Locator, Page } from '@playwright/test';
import type { PanelShells } from '../../../../../src/shared/panels';
import { PROJECT } from '../../../support/fixture';
import { expect, test, type App } from '../../../support/harness';
import { chooseProject, newTerminal, panelTabLabels, panelTabRows } from '../../../support/window';
import { OTHER, withLayout } from '../../layout/layout';

// In All a terminal panel's tabs stand in a row per project, and fold to one, the row of the tab on show, from the tab bar's fold chevron on the header's bottom line (docs/architecture.md § The `terminal` type).
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

const fold = (page: Page): Locator => page.locator('.panel-tabs-fold');

/** What the window last asked main to keep of the panel's shells. */
const lastKept = async (app: App): Promise<PanelShells | undefined> => (await app.calls('setPanelShells')).at(-1)?.[1] as PanelShells | undefined;

/** A shell in each project, then All: two rows. */
async function inAllWithTwoRows(app: App, page: Page): Promise<void> {
  await app.boot(layout);
  await newTerminal(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await chooseProject(page, 'other');
  await newTerminal(page).click();
  await expect(panelTabLabels(page)).toHaveText(['other']);
  await chooseProject(page, 'All');
  await expect(panelTabRows(page)).toHaveCount(2);
}

test('All folds to the row of the tab on show from the chevron, and unfolds from it, and the fold is kept', async ({ app, page }) => {
  await inAllWithTwoRows(app, page);
  await expect(fold(page)).toBeVisible();
  await expect(fold(page)).toHaveAttribute('aria-label', 'Fold the tabs to one row');

  await fold(page).click();
  await expect(panelTabRows(page)).toHaveCount(1);
  // None picked in All yet, so the first row's first tab is on show.
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect(fold(page)).toHaveAttribute('aria-label', 'Unfold the tabs');
  await expect.poll(async () => (await lastKept(app))?.folded).toBe(true);

  await fold(page).click();
  await expect(panelTabRows(page)).toHaveCount(2);
  await expect.poll(async () => (await lastKept(app))?.folded).toBeUndefined();
});

test('folded, the row kept is the one of the tab on show', async ({ app, page }) => {
  await inAllWithTwoRows(app, page);
  await panelTabRows(page).nth(1).locator('.tab').click();
  await fold(page).click();
  await expect(panelTabLabels(page)).toHaveText(['other']);
});

test('the fold is there only while the tabs are in rows', async ({ app, page }) => {
  await app.boot(layout);
  await newTerminal(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo']);
  await expect(fold(page)).toBeHidden();
});

test('the fold lies on the header\'s bottom line, centred across it', async ({ app, page }) => {
  await inAllWithTwoRows(app, page);
  const header = (await page.locator('.panel-header.with-tabs').boundingBox())!;
  const chevron = (await fold(page).boundingBox())!;
  // The line is the header's last pixel; the chevron's middle sits on it.
  expect(Math.abs(chevron.y + chevron.height / 2 - (header.y + header.height - 0.5))).toBeLessThanOrEqual(1);
  expect(Math.abs(chevron.x + chevron.width / 2 - (header.x + header.width / 2))).toBeLessThanOrEqual(1);
});

test('a fold kept from the last launch comes back folded', async ({ app, page }) => {
  const shells: PanelShells = {
    list: [
      { id: 'a', name: 'demo', project: PROJECT, folder: PROJECT },
      { id: 'b', name: 'other', project: OTHER, folder: OTHER },
    ],
    shown: {},
    folded: true,
  };
  await app.boot({ ...layout, activeProject: null, panelData: { shell: { sessions: {}, lastGroup: {}, shells } } });
  await expect(panelTabRows(page)).toHaveCount(1);
  await expect(fold(page)).toHaveAttribute('aria-label', 'Unfold the tabs');
});
