import type { Locator, Page } from '@playwright/test';
import { unstartableReason } from '../../../../../../src/renderer/logic';
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
  // At its prompt, as far as anything has said, so two presses: a third would arm claude's own "press again to exit" under anything it asks.
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  // On its way out: the button does nothing while claude takes its moment to go or to ask.
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
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  await expect(pane(page)).toHaveText('Pick a session in the sidebar to open it.');
});

// Claude can answer an exit with a question — a worktree with changes asks whether to keep it — and waits for the answer: nothing tells that from a claude that hangs, so the stop waits and, a moment on, offers to force it.
test("a stop claude has not answered by leaving stays a stop, its terminal on show, and a moment later the button forces it", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  const close = tab(page, one.title).locator('.tab-close');

  await close.click();
  await expect(close).toBeDisabled();
  await expect(close).toBeEnabled();
  await expect(close).toHaveAttribute('data-tooltip', 'Force stop: claude has not left yet — it may be asking you something');
  // Nothing was ended for it, and what it asks is still on screen to be answered.
  expect(await app.calls('killTerminal')).toEqual([]);
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  const typing = page.locator('.term.active .xterm-helper-textarea');
  await typing.focus();
  await page.keyboard.press('Enter');
  expect(await app.calls('sendTerminalInput')).toContainEqual([FIRST, '\r']);

  await close.click();
  expect(await app.calls('killTerminal')).toEqual([[FIRST]]);
  // Forced once: the button pauses again until the exit lands.
  await expect(close).toBeDisabled();
  await app.emit('onTerminalExit', FIRST, 143);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
});

test('a session mid-turn is pressed a third time, since its first Ctrl-C only interrupts the turn', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await app.emit('onSessionStatus', one.id, 'busy', '', 'PostToolUse');

  await tab(page, one.title).locator('.tab-close').click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, true]]);
});

// Esc at claude's question on the way out takes it back to its prompt; the next prompt is what says it stayed.
test('a prompt submitted by a session asked to leave calls the stop off, and a tool call reported meanwhile does not', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  const token = launch.tabToken!;
  const close = tab(page, one.title).locator('.tab-close');
  const dot = tab(page, one.title).locator('.nudge');

  await close.click();
  await app.emit('onSessionStatus', one.id, 'busy', token, 'PostToolUse');
  await expect(dot).toHaveClass(/\bbusy\b/);
  await expect(close).not.toHaveAttribute('data-tooltip', 'Stop session');

  await app.emit('onSessionStatus', one.id, 'busy', token, 'UserPromptSubmit');
  await expect(close).toHaveAttribute('data-tooltip', 'Stop session');
  await expect(close).toBeEnabled();
  // Live again, so the button stops it again, mid-turn now.
  await close.click();
  expect(await app.calls('closeTerminal')).toEqual([
    [FIRST, false],
    [FIRST, true],
  ]);
});

test('a middle click on a tab that has not left forces it, as its button does', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  const close = tab(page, one.title).locator('.tab-close');

  await tab(page, one.title).click({ button: 'middle' });
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  // During the pause it does nothing, like the button.
  await tab(page, one.title).click({ button: 'middle' });
  expect(await app.calls('killTerminal')).toEqual([]);
  await expect(close).toBeEnabled();
  await tab(page, one.title).click({ button: 'middle' });
  expect(await app.calls('killTerminal')).toEqual([[FIRST]]);
});

// Leaving with Ctrl-C is claude's own, as in a terminal: it exits, or asks what it asks on the way out, and the tab goes with its exit.
test('Ctrl-C goes to claude every time, even twice straight after, and claude leaving closes the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  // The same moment for both presses, however slow the machine is: "straight after" is a time window.
  await page.clock.setFixedTime(Date.now());

  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+C');
  expect(await app.calls('sendTerminalInput')).toEqual([
    [FIRST, '\x03'],
    [FIRST, '\x03'],
  ]);
  expect(await app.calls('closeTerminal')).toEqual([]);
  await expect(tab(page, one.title)).toHaveCount(1);

  await page.clock.setSystemTime(Date.now() + 60_000);
  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveCount(0);
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

test('a session whose folder went away while the app ran is refused its start: the tab stays cold, and its pane and a toast say why', async ({ app, page }) => {
  await app.boot(fixture);
  // Gone from the disk, where the listing read at launch still has it: the one case no gating before the start can see.
  await page.evaluate((folder) => {
    window.__claudeUiFixture.paths[folder] = 'missing';
  }, PROJECT);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);

  const reason = unstartableReason({ ...one, cwdExists: false })!;
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(pane(page)).toContainText(reason);
  await expect(page.locator('#toast-message')).toHaveText(reason);
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

// The process of a failed start has gone, so the tab is cold for everything that asks: its button closes it in one press, the strip does not list it, and selecting it starts it again; only its terminal stays on show, since what claude printed is the explanation.
test('a tab whose start failed is cold: its button closes it at once, nothing lists it as running, and selecting it tries again', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude: command not found')).toBe(1);
  await app.emit('onTerminalExit', FIRST, 127);

  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(pane(page)).toBeHidden();
  await expect(page.locator('.term.active')).toBeVisible();
  await expect(page.locator('#live-strip')).toBeHidden();
  // What the terminal holds is drawn on a canvas rather than into the page, so it is read from the log line, which quotes the last few lines it held.
  const failures = async (): Promise<string[]> =>
    (await app.calls('log')).flatMap(([level, area, message]) => (level === 'warn' && area === 'tab' && String(message).includes('did not start') ? [String(message)] : []));
  await expect.poll(failures).toEqual([expect.stringContaining('claude: command not found')]);

  // Selected again, it starts again, on a terminal wiped of the failed start: the second failure finds nothing printed.
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await app.emit('onTerminalExit', FIRST + 1, 127);
  await expect.poll(async () => (await failures())[1]).toContain('printing nothing');

  await tab(page, one.title).locator('.tab-close').click();
  await expect(tab(page, one.title)).toHaveCount(0);
  // Nothing was running, so nothing was asked to end.
  expect(await app.calls('closeTerminal')).toEqual([]);
  expect(await app.calls('killTerminal')).toEqual([]);
});

// A refused start says why on the pane, and a failed start's lines give way to it rather than showing beside it.
test('a failed start tried again and refused by main says why on the pane, with no terminal beside it', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await app.emit('onTerminalExit', FIRST, 127);
  await expect(pane(page)).toBeHidden();

  // Gone from the disk where the listing still has it: main refuses the start.
  await page.evaluate((folder) => {
    window.__claudeUiFixture.paths[folder] = 'missing';
  }, PROJECT);
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await expect(pane(page)).toContainText(unstartableReason({ ...one, cwdExists: false })!);
  await expect(page.locator('.term.active')).toHaveCount(0);
});

test('a failed start whose folder the listing has since lost is not tried again, and says why on the pane', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await app.emit('onTerminalExit', FIRST, 127);
  await expect(pane(page)).toBeHidden();

  await app.listOnDisk([{ ...one, cwdExists: false }]);
  await tab(page, one.title).locator('.tab-label').click();
  await expect(pane(page)).toContainText(unstartableReason({ ...one, cwdExists: false })!);
  await expect(page.locator('.term.active')).toHaveCount(0);
  expect(await app.calls('startTerminal')).toHaveLength(1);
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
