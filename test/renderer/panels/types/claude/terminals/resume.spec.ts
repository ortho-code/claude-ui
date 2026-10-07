import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { noSettingsFile, session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { tab } from '../../../../support/window';

// At launch every open tab comes back, and the sessions that were running when the app closed start again in theirs, unless the setting says otherwise.
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

type Size = [id: number, cols: number, rows: number];
const sizes = async (app: App): Promise<Size[]> => (await app.calls('resizeTerminal')) as Size[];

test('at launch the sessions that were running start again, the one on show and those out of sight alike, at the same size', async ({ app, page }) => {
  await app.boot(fixture);
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const launches = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launches.map(([, launch]) => launch.resumeSessionId)).toEqual([one.id, two.id]);

  // Still selected where you left off; the one that was not running stays cold.
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect(tab(page, two.title)).not.toHaveClass(/\bcold\b/);
  await expect(tab(page, three.title)).toHaveClass(/\bcold\b/);
  // A folder gone is not tried, and says nothing until its tab is selected.
  await expect(tab(page, gone.title)).toHaveClass(/\bcold\b/);
  await expect(page.locator('#toast')).toBeHidden();

  // Out of sight, the second is sized to the terminal area as the one on show is, not left at xterm's 80 columns.
  const sizeOf = async (id: number): Promise<number[] | undefined> => (await sizes(app)).filter(([pty]) => pty === id).at(-1)?.slice(1);
  await expect.poll(() => sizeOf(2)).toBeDefined();
  const shown = (await sizeOf(1))!;
  expect(shown[0]).toBeGreaterThan(80);
  expect(await sizeOf(2)).toEqual(shown);
});

test('with the setting off in settings.json, nothing starts at launch', async ({ app, page }) => {
  await app.boot({ ...fixture, settings: { yours: settingsFileWith('settings.json', { resumeRunningSessionsOnStartup: false }), app: noSettingsFile('settings.local.json') } });
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  // The restore's last write, after which a start would already have been asked for.
  await expect.poll(() => app.calls('setOpenSessions')).toHaveLength(1);
  expect(await app.calls('startTerminal')).toEqual([]);
});
