import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// The empty terminal pane names the next action, and there are four (docs/architecture.md § UI conventions): no sessions at all, no tabs on show in this project, tabs but none selected, and a selected tab that is not running, which the lifecycle's checks cover.
// It counts the tabs ON SHOW (`visibleTabs`), not every open tab: "pick a tab above" beside an empty bar was the bug that rule fixed.
const OTHER = `${HOME}/projects/other`;
const here = session();
const there = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Over there', cwd: OTHER, repoRoot: OTHER });

test('with no sessions at all, the pane points at + New', async ({ app, page }) => {
  await app.boot({ sessions: [], projectOrder: [], activeProject: null });
  await expect(page.locator('#term-placeholder')).toHaveText('No sessions yet — start one with + New.');
});

test('with tabs open and none selected, the pane points at the tabs and the list', async ({ app, page }) => {
  await app.boot({ openSessions: [here.id] });
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a tab above, or a session in the sidebar, to resume it.');
});

test("scoped to a project whose tabs are all elsewhere, the pane points at the list, not at another project's tabs", async ({ app, page }) => {
  await app.boot({ sessions: [here, there], projectOrder: [PROJECT, OTHER], activeProject: PROJECT, openSessions: [there.id] });
  await expect(page.locator('.tab')).toHaveCount(0);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a session in the sidebar to open it.');
});
