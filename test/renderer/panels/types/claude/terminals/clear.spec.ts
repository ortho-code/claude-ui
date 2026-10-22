import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { group, row, tabLabels, titlesIn } from '../../../../support/window';

// `/clear` ends a session and starts another in the same terminal, under an id Claude Code picks: the tab, which its token names, takes the new session over (docs/architecture.md § Tab lifecycle).
// A cleared session is a new one, so it starts as the "+" button's blank, keeps the group its predecessor was in, and the pairing is recorded, since nothing else can observe it.
const one = session();
const next = '00000000-0000-4000-8000-0000000000cc';
const fixture = {
  history: { [one.id]: [], [next]: [] },
  groupState: { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }], groupOf: { [one.id]: 'g-work' } },
};
const FIRST = 1;


test('a session cleared in its tab hands the tab to its successor, which keeps the group, and the pairing is recorded', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  // What the status hook echoes back to name the tab.
  const token = launch.tabToken ?? '';
  expect(token).not.toBe('');
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);

  // Its start says why (measured on claude 2.1.302: SessionStart with source clear), and only a clear does the clear's part below.
  expect(await app.emit('onSessionStart', next, token, 'clear')).toBe(1);
  await expect(tabLabels(page)).toHaveText(['New: demo']);
  await expect.poll(() => app.calls('recordClear')).toEqual([[one.id, next, one.title]]);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[next], [next], []]);
  await expect.poll(() => app.calls('moveSessionToGroup')).toEqual([[next, 'g-work']]);

  // Its stand-in row, in the group, is the open one; the cleared session keeps its own row, with no tab.
  await expect(titlesIn(group(page, 'Work'))).toHaveText(['New: demo', one.title]);
  await expect(row(page, 'New: demo')).toHaveClass(/\bopen\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bopen\b/);
});

test('a cleared session is new until something is typed in it, then goes by its first prompt until claude names it', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  expect(await app.emit('onSessionStart', next, launch.tabToken ?? '', 'clear')).toBe(1);

  // Its transcript holds only the `/clear`, which main reads as no prompt.
  await app.listOnDisk([one, session({ id: next, title: '', firstMessage: '' })]);
  await expect(tabLabels(page)).toHaveText(['New: demo']);
  await expect(row(page, 'New: demo')).toHaveClass(/\bopen\b/);

  await app.listOnDisk([one, session({ id: next, title: '', firstMessage: 'why is the build slow?' })]);
  await expect(tabLabels(page)).toHaveText(['why is the build slow?']);

  // The name claude copied across the clear, or gave it since, is its name.
  await app.listOnDisk([one, session({ id: next, title: one.title, firstMessage: 'why is the build slow?' })]);
  await expect(tabLabels(page)).toHaveText([one.title]);
});
