import type { Locator, Page } from '@playwright/test';
import { projectGoneReason } from '../../../../../../src/renderer/logic';
import type { Exchange } from '../../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { chooseProject, row, tab, tabs } from '../../../../support/window';

// The empty terminal pane names the next action, and there are four (docs/architecture.md § UI conventions): no sessions at all, no tabs on show in this project, tabs but none selected, and a selected tab that is not running, which the lifecycle's checks cover.
// It counts the tabs ON SHOW (`visibleTabs`), not every open tab: "pick a tab above" beside an empty bar was the bug that rule fixed.
const OTHER = `${HOME}/projects/other`;
const here = session();
const there = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Over there', cwd: OTHER, repoRoot: OTHER });

test('a starting session’s terminal stays inside the terminal area, covered by the pane saying it is starting', async ({ app, page }) => {
  await app.boot({ history: { [here.id]: [] } });
  await row(page, here.title).click();
  await expect(page.locator('#term-placeholder')).toHaveText(`Starting “${here.title}”…`);
  // The terminal is laid out already, fitted before claude starts; in the flow it sat below the pane and hung out of the area over whatever lay under it.
  const [area, terminal] = await Promise.all([page.locator('#terminals').boundingBox(), page.locator('.term.active').boundingBox()]);
  expect(terminal!.y + terminal!.height).toBeLessThanOrEqual(area!.y + area!.height + 1);
  await expect(page.locator('#term-placeholder')).toBeVisible();
});

test('with no sessions at all, the pane points at + New', async ({ app, page }) => {
  await app.boot({ sessions: [], projectOrder: [], activeProject: null });
  await expect(page.locator('#term-placeholder')).toHaveText('No sessions yet — start one with + New.');
});

test('with tabs open and none selected, the pane points at the tabs and the list', async ({ app, page }) => {
  await app.boot({ openSessions: [here.id] });
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a tab above, or a session in the sidebar, to resume it.');
});

test("scoped to a project whose tabs are all elsewhere, the pane points at the list, not at another project's tabs", async ({ app, page }) => {
  await app.boot({ sessions: [here, there], projectOrder: [PROJECT, OTHER], activeProject: PROJECT, openSessions: [there.id] });
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a session in the sidebar to open it.');
});

test('the pane follows the listing on disk: a first session points at the list, and the last one gone at + New', async ({ app, page }) => {
  await app.boot({ sessions: [], projectOrder: [], activeProject: null });
  await expect(page.locator('#term-placeholder')).toHaveText('No sessions yet — start one with + New.');
  await app.listOnDisk([here]);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a session in the sidebar to open it.');
  await app.listOnDisk([]);
  await expect(page.locator('#term-placeholder')).toHaveText('No sessions yet — start one with + New.');
});

test('the pane follows the project chosen: one whose tabs are all elsewhere points at the list, and All at the tabs again', async ({ app, page }) => {
  await app.boot({ sessions: [here, there], projectOrder: [PROJECT, OTHER], activeProject: null, openSessions: [there.id] });
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a tab above, or a session in the sidebar, to resume it.');
  await chooseProject(page, 'demo');
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a session in the sidebar to open it.');
  await chooseProject(page, 'All');
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a tab above, or a session in the sidebar, to resume it.');
});

test("the pane follows the project on show's folder: gone from disk, it says the project cannot run", async ({ app, page }) => {
  await app.boot({ sessions: [here], activeProject: PROJECT });
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a session in the sidebar to open it.');
  await app.listOnDisk([{ ...here, cwdExists: false, repoRootExists: false }]);
  await expect(page.locator('#term-placeholder')).toHaveText(projectGoneReason(PROJECT));
});

// The pane hands itself to the tab on show's history and back: by its keys, and per tab, as each was left.
const other = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Another session' });
const TIME = '2026-09-30T08:00:00.000Z';
// Each reply taller than the pane, so every request can be brought to the top and which one is there says where the history is.
const exchange = (id: string, request: string): Exchange => ({
  id,
  time: TIME,
  request,
  kind: 'typed',
  replaced: false,
  rewound: false,
  parts: [{ kind: 'text', id: `${id}-reply`, time: TIME, text: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of the reply.`).join('\n\n') }],
});
const history = { [here.id]: [exchange('request-1', 'First request'), exchange('request-2', 'Second request'), exchange('request-3', 'Third request')], [other.id]: [exchange('request-4', 'Its only request')] };
const both = { sessions: [here, other], openSessions: [here.id, other.id], activeSession: here.id, history };

const drawer = (page: Page): Locator => page.locator('.history');

/** Select the tab, which starts it, and let its claude print, so it is live; the ptys are numbered in the order they start. */
async function goLive(page: Page, app: App, title: string, pty: number): Promise<void> {
  await tab(page, title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(pty);
  expect(await app.emit('onTerminalData', pty, 'claude is here')).toBe(1);
  await expect(page.locator('#term-placeholder')).toBeHidden();
}

/** The request at the top of the history's view, by the rule its steps go by: the last one whose request line is at or above the top. */
function atTop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.history-scroll')!;
    let found = '';
    for (const request of document.querySelectorAll<HTMLElement>('.history .exchange-request')) {
      if (request.offsetTop - 4 <= scroller.scrollTop + 8) found = request.querySelector('.exchange-request-text')!.textContent!;
    }
    return found;
  });
}

// A failed start's terminal stays on show with what claude said before it went, so its history opens over it as a live one's does, not under the pane.
test("Ctrl+Shift+↑ on a failed start's tab opens the history over its terminal", async ({ app, page }) => {
  await app.boot({ ...both, openSessions: [here.id] });
  await tab(page, here.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await app.emit('onTerminalExit', 1, 127);
  const placeholder = page.locator('#term-placeholder');
  await expect(placeholder).toBeHidden();
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
  await expect(page.locator('.history-bar')).not.toHaveClass(/\bunavailable\b/);

  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(drawer(page)).toBeVisible();
  await expect(placeholder).toBeHidden();
  // The drawer, not the history standing under the pane's sentence with a Resume button.
  await expect(page.locator('.history-note-text')).toBeHidden();
});

test('from live, Ctrl+Shift+↑ opens the history at the last request, the two keys step through it, and ↓ past the last is live again', async ({ app, page }) => {
  await app.boot({ ...both, openSessions: [here.id] });
  await goLive(page, app, here.title, 1);
  await expect(page.locator('.history .exchange')).toHaveCount(3);
  const typing = page.locator('.term.active .xterm-helper-textarea');
  await expect(typing).toBeFocused();

  // Live, ↓ has nothing to go to.
  await page.keyboard.press('Control+Shift+ArrowDown');
  await expect(drawer(page)).toBeHidden();

  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(drawer(page)).toBeVisible();
  await expect.poll(() => atTop(page)).toBe('Third request');
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect.poll(() => atTop(page)).toBe('Second request');
  await page.keyboard.press('Control+Shift+ArrowDown');
  await expect.poll(() => atTop(page)).toBe('Third request');

  await page.keyboard.press('Control+Shift+ArrowDown');
  await expect(drawer(page)).toBeHidden();
  await expect(typing).toBeFocused();
  // Taken by the pane, never sent to claude as keys.
  expect(await app.calls('sendTerminalInput')).toEqual([]);
});

test('each tab keeps its history as it was left: open where it was on one, closed on the other', async ({ app, page }) => {
  await app.boot(both);
  await goLive(page, app, here.title, 1);
  await goLive(page, app, other.title, 2);
  await tab(page, here.title).click();
  await expect(page.locator('.history .exchange')).toHaveCount(3);
  await page.keyboard.press('Control+Shift+ArrowUp');
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect.poll(() => atTop(page)).toBe('Second request');

  await tab(page, other.title).click();
  await expect(page.locator('.history .exchange')).toHaveCount(1);
  await expect(drawer(page)).toBeHidden();

  await tab(page, here.title).click();
  await expect(drawer(page)).toBeVisible();
  await expect.poll(() => atTop(page)).toBe('Second request');
});

/** Reopen the session's tab from its row and let its claude print; then its history has been read, and would have reopened by now if it was going to. */
async function reopen(page: Page, app: App, pty: number): Promise<void> {
  await row(page, here.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(pty);
  expect(await app.emit('onTerminalData', pty, 'claude is here')).toBe(1);
  await expect(page.locator('.history .exchange-request-text').first()).toHaveText('First request');
}

test("a tab closed while its history was open on show forgets it: reopened, the session's history starts closed", async ({ app, page }) => {
  await app.boot(both);
  await goLive(page, app, other.title, 1);
  await goLive(page, app, here.title, 2);
  await expect(page.locator('.history .exchange')).toHaveCount(3);
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(drawer(page)).toBeVisible();

  // claude ending by itself, past the moment in which an exit reads as a failed start: the tab closes and the pane goes to the other one.
  await page.clock.setSystemTime(Date.now() + 60_000);
  await app.emit('onTerminalExit', 2, 0);
  await expect(tab(page, here.title)).toHaveCount(0);
  await expect(tab(page, other.title)).toHaveClass(/\bactive\b/);
  await expect(drawer(page)).toBeHidden();

  await reopen(page, app, 3);
  await expect(drawer(page)).toBeHidden();
});

test("a tab closed after it was left with its history open forgets it: reopened, the session's history starts closed", async ({ app, page }) => {
  await app.boot(both);
  await goLive(page, app, here.title, 1);
  await expect(page.locator('.history .exchange')).toHaveCount(3);
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(drawer(page)).toBeVisible();
  await goLive(page, app, other.title, 2);

  // Stopped, then closed, from its tab's button.
  const close = tab(page, here.title).locator('.tab-close');
  await close.click();
  await app.emit('onTerminalExit', 1, 0);
  await expect(close).toBeEnabled();
  await close.click();
  await expect(tab(page, here.title)).toHaveCount(0);

  await reopen(page, app, 3);
  await expect(drawer(page)).toBeHidden();
});
