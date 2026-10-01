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

  expect(await app.emit('onSessionStatus', next, 'start', token)).toBe(1);
  await expect(tabLabels(page)).toHaveText(['New: demo']);
  await expect.poll(() => app.calls('recordClear')).toEqual([[one.id, next, one.title]]);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[next]]);
  await expect.poll(() => app.calls('moveSessionToGroup')).toEqual([[next, 'g-work']]);

  // Its stand-in row, in the group, is the open one; the cleared session keeps its own row, with no tab.
  await expect(titlesIn(group(page, 'Work'))).toHaveText(['New: demo', one.title]);
  await expect(row(page, 'New: demo')).toHaveClass(/\bopen\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bopen\b/);
});
