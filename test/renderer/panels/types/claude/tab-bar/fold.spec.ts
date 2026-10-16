import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row, tab, tabBarFold, tabBarGroup, tabBarGroupRow, tabBarProject, tabBarRows, tabLabels, tabLabelsIn } from '../../../../support/window';

// The tab bar folds to the row of the tab on show, from the fold chevron on the line under it, to give the terminal the room; the fold is kept, and the chevron turns into the dot of a tab it hides that asks for you.
const OTHER = `${HOME}/projects/other`;
const looseOne = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Loose one' });
const looseTwo = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Loose two' });
const reviewOne = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Review one' });
const reviewTwo = session({ id: '00000000-0000-4000-8000-0000000000f4', title: 'Review two' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000f5', title: 'Elsewhere', cwd: OTHER, repoRoot: OTHER });
const all = [looseOne, looseTwo, reviewOne, reviewTwo, elsewhere];
const fixture = {
  sessions: all,
  projectOrder: [PROJECT, OTHER],
  activeProject: PROJECT,
  openSessions: all.map((s) => s.id),
  activeSession: reviewOne.id,
  activeSessionByProject: { [PROJECT]: reviewOne.id },
  groupState: { groups: [{ id: 'g-review', name: 'Review', repoRoot: PROJECT }], groupOf: { [reviewOne.id]: 'g-review', [reviewTwo.id]: 'g-review' } },
  history: Object.fromEntries(all.map((s) => [s.id, []])),
};
const folded = { ...defaultUi(), tabBarExpanded: false };

test("the chevron folds the bar to the row of the tab on show and opens it again, and the fold is kept", async ({ app, page }) => {
  await app.boot(fixture);
  const fold = tabBarFold(page);
  await expect(tabBarRows(page)).toHaveCount(2);
  await expect(fold).toHaveAttribute('aria-expanded', 'true');

  await fold.click();
  await expect(tabBarRows(page)).toHaveCount(1);
  await expect(tabLabelsIn(tabBarGroupRow(page, 'Review'))).toHaveText([reviewOne.title, reviewTwo.title]);
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await app.saved())?.tabBarExpanded).toBe(false);

  await fold.click();
  await expect(tabBarRows(page)).toHaveCount(2);
  await expect(tabLabels(page)).toHaveText([looseOne.title, looseTwo.title, reviewOne.title, reviewTwo.title]);
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await app.saved())?.tabBarExpanded).toBe(true);
});

// The fold chevron a panel group folds from, on the line the tabs sit on: centred along it and across it, folded or not, faint until the line is pointed at.
test('the chevron lies centred on the line under the tabs, folded or not, and brightens when the line is pointed at', async ({ app, page }) => {
  await app.boot(fixture);
  const fold = tabBarFold(page);
  const edge = page.locator('#tabbar-edge');
  const centredOnTheLine = async (): Promise<void> => {
    const chevron = (await fold.boundingBox())!;
    const line = (await edge.boundingBox())!;
    const lastRow = (await tabBarRows(page).last().boundingBox())!;
    // The line is the edge's top pixel, and the tabs sit on it.
    expect(lastRow.y + lastRow.height).toBeCloseTo(line.y, 1);
    expect(chevron.x + chevron.width / 2).toBeCloseTo(line.x + line.width / 2, 1);
    expect(chevron.y + chevron.height / 2).toBeCloseTo(line.y + 0.5, 1);
  };
  await centredOnTheLine();
  await expect(fold).toHaveCSS('opacity', '0.35');
  await edge.hover({ position: { x: 10, y: 3 } });
  await expect(fold).toHaveCSS('opacity', '1');

  await fold.click();
  await expect(tabBarRows(page)).toHaveCount(1);
  await centredOnTheLine();
});

test('the bar comes back folded after a restart', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: folded });
  await expect(tabBarRows(page)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([reviewOne.title, reviewTwo.title]);
  await expect(tabBarFold(page)).toHaveAttribute('aria-expanded', 'false');
});

test('folded, the bar follows the tab on show to its row, wherever it was chosen', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: folded });
  await expect(tabLabels(page)).toHaveText([reviewOne.title, reviewTwo.title]);

  await row(page, looseTwo.title).click();
  await expect(tab(page, looseTwo.title)).toHaveClass(/\bactive\b/);
  await expect(tabBarRows(page)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([looseOne.title, looseTwo.title]);
});

// A group's row says nothing of its project, and in All nothing else on a folded bar would; unfolded, the project's own row carries the name.
test("folded in All, a group's row carries its project's name in front of the group's", async ({ app, page }) => {
  await app.boot({ ...fixture, activeProject: null, activeSessionByProject: {} });
  await expect(tabBarProject(page, 'demo')).toHaveCount(1);
  await expect(tabBarRows(page)).toHaveCount(3);

  await tabBarFold(page).click();
  await expect(tabBarRows(page)).toHaveCount(1);
  const kept = tabBarGroupRow(page, 'Review');
  await expect(tabLabelsIn(kept)).toHaveText([reviewOne.title, reviewTwo.title]);
  await expect(kept.locator('.tab-project-label')).toHaveText('demo');
  await expect(tabBarGroup(page, 'Review')).toBeVisible();
});

// So the pane's "Pick a tab above" always has a tab above it: the first row that holds one, which in All need not be the bar's first row.
test('folded with no tab on show, the bar keeps the first row that holds a tab', async ({ app, page }) => {
  const grouped = [reviewOne, reviewTwo, elsewhere];
  await app.boot({ ...fixture, openSessions: grouped.map((s) => s.id), activeProject: null, activeSession: null, activeSessionByProject: {}, uiState: folded });
  await expect(page.locator('#term-placeholder')).toContainText('Pick a tab above');
  await expect(tabBarRows(page)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([reviewOne.title, reviewTwo.title]);
  await expect(tabBarRows(page).locator('.tab-project-label')).toHaveText('demo');
});

// A tab out of sight that asks something of you — waiting, or finished and not read — turns the chevron into its dot, at full strength; work in progress asks nothing and leaves the chevron be, and a tab in sight speaks for itself.
// Pointing at the line brings the chevron back, so the control says what it does before it is pressed.
test('folded, the chevron turns into the dot of a tab out of sight that asks for you, and back when its line is pointed at', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: folded });
  const fold = tabBarFold(page);
  const dot = fold.locator('.nudge');
  const arrow = fold.locator('svg');
  const asChevron = async (): Promise<void> => {
    await expect(arrow).toBeVisible();
    await expect(dot).toBeHidden();
    await expect(fold).toHaveCSS('opacity', '0.35');
    await expect(fold).toHaveAttribute('aria-label', 'Unfold the tab bar');
  };
  const asDot = async (status: 'waiting' | 'idle', said: string): Promise<void> => {
    await expect(dot).toBeVisible();
    await expect(dot).toHaveClass(new RegExp(`\\b${status}\\b`));
    await expect(arrow).toBeHidden();
    await expect(fold).toHaveCSS('opacity', '1');
    await expect(fold).toHaveAttribute('aria-label', `Unfold the tab bar: a tab out of sight is ${said}`);
  };
  await expect(tabLabels(page)).toHaveText([reviewOne.title, reviewTwo.title]);
  await asChevron();

  expect(await app.emit('onSessionStatus', reviewTwo.id, 'waiting', '', 'Notification')).toBe(1);
  await expect(tab(page, reviewTwo.title).locator('.nudge')).toHaveClass(/\bwaiting\b/);
  await asChevron();

  expect(await app.emit('onSessionStatus', looseOne.id, 'busy', '', 'PreToolUse')).toBe(1);
  await expect(row(page, looseOne.title).locator('.nudge')).toHaveClass(/\bbusy\b/);
  await asChevron();

  expect(await app.emit('onSessionStatus', looseOne.id, 'idle', '', 'Stop')).toBe(1);
  await asDot('idle', 'idle');
  expect(await app.emit('onSessionStatus', looseTwo.id, 'waiting', '', 'Notification')).toBe(1);
  await asDot('waiting', 'waiting for you');

  await page.locator('#tabbar-edge').hover({ position: { x: 10, y: 3 } });
  await expect(arrow).toBeVisible();
  await expect(dot).toBeHidden();
  await page.mouse.move(0, 0);
  await asDot('waiting', 'waiting for you');

  // Marked read from its row in the list, the waiting one asks nothing, and the other's idle speaks; read too, nothing does.
  await row(page, looseTwo.title).locator('.nudge').click();
  await asDot('idle', 'idle');
  await row(page, looseOne.title).locator('.nudge').click();
  await asChevron();

  // Unfolded, nothing is out of sight.
  await row(page, looseOne.title).locator('.nudge').click();
  await asDot('idle', 'idle');
  await fold.click();
  await expect(tabBarRows(page)).toHaveCount(2);
  await page.mouse.move(0, 0);
  await expect(arrow).toBeVisible();
  await expect(dot).toBeHidden();
  await expect(fold).toHaveCSS('opacity', '0.35');
  await expect(fold).toHaveAttribute('aria-label', 'Fold the tab bar to one row');
});

// Folded is a stance, so the chevron stays on a bar of one row; it goes, with its line, only with the bar's last tab, as the strip goes when it has nothing.
test('the chevron is there on a bar of one row, and goes with its line and the last tab', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [looseOne.id], activeSession: looseOne.id, activeSessionByProject: { [PROJECT]: looseOne.id } });
  await expect(tabBarRows(page)).toHaveCount(1);
  await expect(tabBarFold(page)).toBeVisible();

  // Cold, so one press of its button closes it.
  await tab(page, looseOne.title).locator('.tab-close').click();
  await expect(tabBarRows(page)).toHaveCount(0);
  await expect(tabBarFold(page)).toBeHidden();
  await expect(page.locator('#tabbar-edge')).toBeHidden();
});
