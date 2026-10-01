import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab, tabs } from '../../../../support/window';

// A tab's life (docs/architecture.md § Tab lifecycle): selecting it starts it, it boots until claude prints, its button stops the session and keeps the tab cold, a second press closes it; claude ending by itself closes the tab, unless it ended so soon that the start failed.
const one = session();
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

const pane = (page: Page): Locator => page.locator('#term-placeholder');

/** Start the session's row and let claude print, so the tab is live. */
async function startLive(page: Page, app: App): Promise<void> {
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  await expect(pane(page)).toBeHidden();
}

test('a row starts its session by resuming it, and the pane says it is starting until claude prints', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(cwd).toBe(PROJECT);
  // It has a transcript, so it is resumed under its own id rather than created under it.
  expect(launch.resumeSessionId).toBe(one.id);
  expect(launch.sessionId).toBeUndefined();

  await expect(pane(page)).toHaveText(`Starting “${one.title}”…`);
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect(tab(page, one.title)).not.toHaveClass(/\bcold\b/);
  // Output that draws nothing is not yet something to show.
  await app.emit('onTerminalData', FIRST, '\x1b[?25l');
  await expect(pane(page)).toBeVisible();
  await app.emit('onTerminalData', FIRST, 'claude is here');
  await expect(pane(page)).toBeHidden();
});

test("a new session starts under an id the window minted, and its row is in the list before claude has written anything", async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('.project-add').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(cwd).toBe(PROJECT);
  expect(launch.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(launch.resumeSessionId).toBeUndefined();

  await expect(tab(page, 'New: demo')).toHaveClass(/\bactive\b/);
  await expect(row(page, 'New: demo')).toBeVisible();
});

test("closing the tab of a session that never wrote anything takes its stand-in row out of the list", async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('.project-add').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  await expect(row(page, 'New: demo')).toBeVisible();

  // Stopped, then closed: it never wrote a transcript, so its tab was all that put it in the list.
  const close = tab(page, 'New: demo').locator('.tab-close');
  await close.click();
  await app.emit('onTerminalExit', FIRST, 0);
  await expect(close).toBeEnabled();
  await close.click();
  await expect(tab(page, 'New: demo')).toHaveCount(0);
  await expect(row(page, 'New: demo')).toHaveCount(0);
  await expect(row(page, one.title)).toHaveCount(1);
});

test("the tab's button stops the session and keeps the tab cold, and a second press closes it", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  const close = tab(page, one.title).locator('.tab-close');

  await close.click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST]]);
  // On its way out: the button does nothing until the session has really ended.
  await expect(close).toBeDisabled();

  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  // Stopping what you were looking at drops you to the empty screen, rather than leaving a selected tab with nothing behind it.
  await expect(tab(page, one.title)).not.toHaveClass(/\bactive\b/);
  await expect(pane(page)).toHaveText('Pick a tab above, or a session in the sidebar, to resume it.');
  await expect(close).toBeEnabled();

  await close.click();
  await expect(tab(page, one.title)).toHaveCount(0);
  // Nothing was running, so nothing more to end.
  expect(await app.calls('closeTerminal')).toEqual([[FIRST]]);
  await expect(pane(page)).toHaveText('Pick a session in the sidebar to open it.');
});

test('Ctrl-C goes to claude, and a second one straight after closes the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  // The same moment for both presses, however slow the machine is: "straight after" is a time window.
  await page.clock.setFixedTime(Date.now());

  await page.keyboard.press('Control+C');
  expect(await app.calls('sendTerminalInput')).toEqual([[FIRST, '\x03']]);
  await expect(tab(page, one.title)).toHaveCount(1);

  await page.keyboard.press('Control+C');
  await expect(tab(page, one.title)).toHaveCount(0);
  expect(await app.calls('closeTerminal')).toEqual([[FIRST]]);
  expect(await app.calls('sendTerminalInput')).toEqual([[FIRST, '\x03']]);
});

test('a tab restored where you left off is selected and not started, and Resume starts it', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [one.id], activeSession: one.id });
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(pane(page)).toContainText(`“${one.title}” isn’t running.`);
  await expect(pane(page).getByRole('button', { name: 'Show history' })).toBeVisible();
  expect(await app.calls('startTerminal')).toEqual([]);

  await pane(page).getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(pane(page)).toHaveText(`Starting “${one.title}”…`);
});

test('the tabs restored at launch are drawn once, not once per tab', async ({ app, page }) => {
  const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
  const three = session({ id: '00000000-0000-4000-8000-000000000003', title: 'Third session' });
  // Counted from before the window's own scripts run: every drawing of the bar builds its rows afresh, and these three share one row.
  await page.addInitScript(() => {
    const drawn: Node[] = [];
    (window as unknown as { __rowsDrawn: Node[] }).__rowsDrawn = drawn;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element && node.matches('.tab-project')) drawn.push(node);
    }).observe(document, { childList: true, subtree: true });
  });
  await app.boot({ sessions: [one, two, three], openSessions: [one.id, two.id, three.id], activeSession: three.id, history: { [one.id]: [], [two.id]: [], [three.id]: [] } });
  // The restore's last step: the tab you left off in, selected.
  await expect(tab(page, three.title)).toHaveClass(/\bactive\b/);
  await expect(tabs(page)).toHaveCount(3);
  expect(await page.evaluate(() => (window as unknown as { __rowsDrawn: Node[] }).__rowsDrawn.length)).toBe(1);
});

test('claude ending within moments of its start keeps the tab, uncovered, and logs what it said', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);

  await app.emit('onTerminalExit', FIRST, 1);
  // Kept, with the pane uncovered: the terminal's own last line is the explanation.
  await expect(tab(page, one.title)).toHaveCount(1);
  await expect(pane(page)).toBeHidden();
  await expect
    .poll(async () => (await app.calls('log')).some(([level, area, message]) => level === 'warn' && area === 'tab' && String(message).includes(`session ${one.id} did not start`)))
    .toBe(true);
});

test('claude ending by itself later closes its tab', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  // Past the moment in which an exit reads as a failed start.
  await page.clock.setSystemTime(Date.now() + 60_000);

  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(pane(page)).toHaveText('Pick a session in the sidebar to open it.');
});
