import type { RunningAtLaunch } from '../../../../../../src/shared/settings';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { type BridgeFixture, noSettingsFile, session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { stripNames, tab } from '../../../../support/window';

// At launch every open tab comes back, and the sessions that were running when the app closed come back as the setting says: paused, by default, started again, or with the other tabs.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
const three = session({ id: '00000000-0000-4000-8000-000000000003', title: 'Third session' });
const gone = session({ id: '00000000-0000-4000-8000-000000000004', title: 'Folder gone', cwdExists: false });
const all = [one, two, three, gone];
const fixture = {
  sessions: all,
  openSessions: all.map((s) => s.id),
  runningSessions: [one.id, two.id, gone.id],
  activeSession: one.id,
  // A tab on show has its history read; what it holds is not what is checked here.
  history: Object.fromEntries(all.map((s) => [s.id, []])),
};
/** The fixture with the choice in settings.json. */
const choosing = (choice: RunningAtLaunch): Partial<BridgeFixture> => ({
  ...fixture,
  settings: { yours: settingsFileWith('settings.json', { runningSessionsAtLaunch: choice }), app: noSettingsFile('settings.local.json') },
});

type Size = [id: number, cols: number, rows: number];
const sizes = async (app: App): Promise<Size[]> => (await app.calls('resizeTerminal')) as Size[];

test('by default the sessions that were running come back paused, in the live strip, and nothing starts', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  // The restore's last write, after which a start would already have been asked for.
  await expect.poll(() => app.calls('setOpenSessions')).toHaveLength(1);
  expect(await app.calls('startTerminal')).toEqual([]);
  expect((await app.calls('setOpenSessions')).at(-1)).toEqual([all.map((s) => s.id), [], [one.id, two.id, gone.id]]);
  for (const s of [one, two, gone]) await expect(tab(page, s.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  await expect(tab(page, three.title).locator('.nudge')).not.toHaveClass(/\bpaused\b/);
  await expect(stripNames(page)).toHaveText([one.title, two.title, gone.title]);
});

test('chosen to start, the sessions that were running start again, the one on show and those out of sight alike, at the same size', async ({ app, page }) => {
  await app.boot(choosing('start'));
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const launches = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launches.map(([, launch]) => launch.resumeSessionId)).toEqual([one.id, two.id]);

  // Still selected where you left off; the one that was not running stays cold.
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect(tab(page, two.title)).not.toHaveClass(/\bcold\b/);
  await expect(tab(page, three.title)).toHaveClass(/\bcold\b/);
  // A folder gone is not tried, and says nothing until its tab is selected; it stays paused, so the strip still holds what was in hand.
  await expect(tab(page, gone.title)).toHaveClass(/\bcold\b/);
  await expect(tab(page, gone.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  await expect(page.locator('#toast')).toBeHidden();
  // Started, they lose the mark.
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([all.map((s) => s.id), [one.id, two.id], [gone.id]]);

  // Out of sight, the second is sized to the terminal area as the one on show is, not left at xterm's 80 columns.
  const sizeOf = async (id: number): Promise<number[] | undefined> => (await sizes(app)).filter(([pty]) => pty === id).at(-1)?.slice(1);
  await expect.poll(() => sizeOf(2)).toBeDefined();
  const shown = (await sizeOf(1))!;
  expect(shown[0]).toBeGreaterThan(80);
  expect(await sizeOf(2)).toEqual(shown);
});

test('chosen to leave them, the sessions that were running come back cold with the other tabs, unmarked, and nothing starts', async ({ app, page }) => {
  await app.boot(choosing('leave'));
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect.poll(() => app.calls('setOpenSessions')).toHaveLength(1);
  expect(await app.calls('startTerminal')).toEqual([]);
  expect((await app.calls('setOpenSessions')).at(-1)).toEqual([all.map((s) => s.id), [], []]);
  await expect(page.locator('#live-strip')).toBeHidden();
});

test('a tab you paused comes back paused whatever the choice, and is never started', async ({ app, page }) => {
  await app.boot({ ...choosing('start'), pausedSessions: [two.id] });
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(one.id);
  await expect(tab(page, two.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
});
