import type { Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { type BridgeFixture, PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { group, row, tab, tabLabels, titlesIn } from '../../../../support/window';

// claude's own `/resume` inside a tab ends the tab's session and goes on in another that already exists, under that session's own id (measured on claude 2.1.302: SessionEnd with reason resume, then SessionStart with source resume).
// The tab takes that session over as it is — its title, its group — and nothing about it is a `/clear`: no pairing recorded, no group carried over.
// Archiving is claude-ui's and claude cannot see it, so a resume can land in an archived session: it is unarchived, and a toast says so, since the app runs no archived session.
const one = session({ title: 'Running one' });
const old = session({ id: '00000000-0000-4000-8000-0000000000dd', title: 'Older one' });
const groups = { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }, { id: 'g-other', name: 'Other', repoRoot: PROJECT }], groupOf: { [one.id]: 'g-work', [old.id]: 'g-other' } };
const FIRST = 1;

/** Boot with `one` running in a tab, and hand back the token its hook events carry. */
async function running(app: App, page: Page, extra: Partial<BridgeFixture> = {}): Promise<string> {
  await app.boot({ sessions: [one, old], history: { [one.id]: [], [old.id]: [] }, groupState: groups, ...extra });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  const token = launch.tabToken ?? '';
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  return token;
}

test('a session resumed in a tab is taken over as it is, with no pairing recorded and its group kept', async ({ app, page }) => {
  const token = await running(app, page);
  await app.emit('onSessionStatus', one.id, 'closed', token, 'SessionEnd');
  expect(await app.emit('onSessionStart', old.id, token, 'resume')).toBe(1);

  await expect(tabLabels(page)).toHaveText([old.title]);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[old.id], [old.id], []]);
  await expect(row(page, old.title)).toHaveClass(/\bopen\b/);
  await expect(titlesIn(group(page, 'Other'))).toHaveText([old.title]);
  expect(await app.calls('recordClear')).toEqual([]);
  expect(await app.calls('moveSessionToGroup')).toEqual([]);
});

test('a session the tab learns of from another event than its start is taken over without a pairing or a group move, since nothing says it was a clear', async ({ app, page }) => {
  const token = await running(app, page);
  await app.emit('onSessionStatus', one.id, 'closed', token, 'SessionEnd');
  await app.emit('onSessionStatus', old.id, 'busy', token, 'UserPromptSubmit');

  await expect(tabLabels(page)).toHaveText([old.title]);
  await expect(titlesIn(group(page, 'Other'))).toHaveText([old.title]);
  expect(await app.calls('recordClear')).toEqual([]);
  expect(await app.calls('moveSessionToGroup')).toEqual([]);
});

test('an archived session resumed in a tab is unarchived, a toast says so, and its tab has the menu of a running session', async ({ app, page }) => {
  const token = await running(app, page, { archived: { [old.id]: Date.parse('2026-10-01T08:00:00.000Z') } });
  await app.emit('onSessionStatus', one.id, 'closed', token, 'SessionEnd');
  await app.emit('onSessionStart', old.id, token, 'resume');

  await expect.poll(() => app.calls('unarchive')).toEqual([[old.id]]);
  await expect(page.locator('#toast-message')).toHaveText(`"${old.title}" was archived; resuming it in claude unarchived it`);
  await expect(titlesIn(group(page, 'Other'))).toHaveText([old.title]);
  await tab(page, old.title).locator('.tab-kebab').click();
  const items = page.locator('.kebab-menu button.menu-row');
  await expect(items.filter({ hasText: /^Stop session$/ })).toHaveCount(1);
  await expect(items.filter({ hasText: /^Archive$/ })).toBeDisabled();
  await expect(items.filter({ hasText: /^Delete session/ })).toHaveCount(0);
});

// Main reads each status file as it changes, and the reads can finish in either order, so the session the tab left can report its end after the start of the one it went on in.
// A session that has ended is never what a tab runs, so its end moves no tab.
test('the end of the session a tab left, arriving after the start of the one it went on in, leaves the tab where it is', async ({ app, page }) => {
  const token = await running(app, page);
  await app.emit('onSessionStart', old.id, token, 'resume');
  await expect(tabLabels(page)).toHaveText([old.title]);
  await app.emit('onSessionStatus', one.id, 'closed', token, 'SessionEnd');

  await expect(row(page, one.title)).not.toHaveClass(/\bopen\b/);
  await expect(tabLabels(page)).toHaveText([old.title]);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[old.id], [old.id], []]);
});

// claude lets a second claude resume a session another runs, with no warning, and the two then branch its transcript: each turn hangs off the same message, and a later resume follows one branch, dropping the other's turn (measured on claude 2.1.302).
// No hook can refuse a `/resume`, so the app undoes it the moment it hears: the claude that switched is forced out, since in the app it was seen to ignore the Ctrl-C an ask to leave sends, its tab keeps the session it ran before, and the tab already running the session comes on show, with a toast saying why.
test('a session resumed in a tab while another tab runs it is undone: that claude is forced out, its tab keeps its session, and the other tab comes on show', async ({ app, page }) => {
  const token = await running(app, page);
  await row(page, old.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const [, [, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  const other = launch.tabToken ?? '';
  expect(await app.emit('onTerminalData', FIRST + 1, 'claude is here')).toBe(1);
  await app.emit('onSessionStatus', old.id, 'busy', other, 'UserPromptSubmit');
  await tab(page, one.title).click();
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);

  await app.emit('onSessionStatus', one.id, 'closed', token, 'SessionEnd');
  await app.emit('onSessionStart', old.id, token, 'resume');

  await expect(page.locator('#toast-message')).toHaveText(`"${old.title}" is already running in another tab`);
  await expect(tabLabels(page)).toHaveText([one.title, old.title]);
  await expect(tab(page, old.title)).toHaveClass(/\bactive\b/);
  await expect.poll(() => app.calls('killTerminal')).toEqual([[FIRST]]);
  expect(await app.calls('closeTerminal')).toEqual([]);
  // A report from it while it goes asks nothing more of it.
  await app.emit('onSessionStatus', old.id, 'busy', token, 'PostToolUse');
  expect(await app.calls('killTerminal')).toEqual([[FIRST]]);
  // On its way out the stopped claude reports the session's end, which is not the session's: it runs on in the other tab.
  await app.emit('onSessionStatus', old.id, 'closed', token, 'SessionEnd');
  await app.emit('onTerminalExit', FIRST, 143);
  await expect(tab(page, old.title).locator('.nudge')).toHaveClass(/\bbusy\b/);
  await expect(tabLabels(page)).toHaveText([one.title, old.title]);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[one.id, old.id], [old.id], []]);
});

// A tab holding the session with no claude behind it, cold or paused, runs nothing that could branch it: the tab that went on in it is the session's tab now, and the other goes.
test('a session resumed in a tab while another tab holds it cold leaves it in the tab that resumed it, and the cold tab goes', async ({ app, page }) => {
  const token = await running(app, page, { openSessions: [old.id] });
  await expect(tabLabels(page)).toHaveText([one.title, old.title]);
  await app.emit('onSessionStatus', one.id, 'closed', token, 'SessionEnd');
  await app.emit('onSessionStart', old.id, token, 'resume');

  await expect(tabLabels(page)).toHaveText([old.title]);
  await expect(tab(page, old.title)).toHaveClass(/\bactive\b/);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[old.id], [old.id], []]);
  expect(await app.calls('closeTerminal')).toEqual([]);
  expect(await app.calls('startTerminal')).toHaveLength(1);
  // The cold tab goes, and the session's status with it would be the running tab's.
  expect((await app.calls('clearStatus')).flat()).not.toContain(old.id);
});

// An end the app reads from a transcript carries the tab the status file last named, which after a restart, or a resume that left the file as it was, is not the tab running the session now: it is the session's all the same.
test('a status reported under another tab than the one running the session is the session’s, unless it is an end', async ({ app, page }) => {
  await running(app, page);
  await app.emit('onSessionStatus', one.id, 'busy', 'stale-token', 'UserPromptSubmit');
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bbusy\b/);
  await app.emit('onSessionStatus', one.id, 'closed', 'stale-token', 'SessionEnd');
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bbusy\b/);
});
