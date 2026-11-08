import type { RunningAtLaunch } from '../../../../../../src/shared/settings';
import type { ClosedHow, TerminalLaunch } from '../../../../../../src/shared/types';
import { type BridgeFixture, session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { needsYouFile, switchedOff } from '../../../../support/needsyou';
import { tab } from '../../../../support/window';

// At launch every open tab comes back, and the sessions that were running when the app closed come back as the setting says, cold by default or started again, and marked as needing you unless a file of yours switches that type off.
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
  settings: settingsFileWith('settings.json', { runningSessionsAtLaunch: choice }),
});

type Size = [id: number, cols: number, rows: number];
const sizes = async (app: App): Promise<Size[]> => (await app.calls('resizeTerminal')) as Size[];

test('by default the sessions that were running come back marked as needing you, not paused, and nothing starts', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  // The restore's last write, after which a start would already have been asked for.
  await expect.poll(() => app.calls('setOpenSessions')).toHaveLength(1);
  expect(await app.calls('startTerminal')).toEqual([]);
  expect((await app.calls('setOpenSessions')).at(-1)).toEqual([all.map((s) => s.id), []]);
  // From the time the window marked them with, so main's copy and the window's agree.
  expect(await app.calls('markNeedsYou')).toEqual([[[one.id, two.id, gone.id], [{ type: 'app.was-running', at: expect.any(Number), how: 'quit' }]]]);
  for (const s of [one, two, gone]) await expect(tab(page, s.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(tab(page, three.title).locator('.nudge')).not.toHaveClass(/\bneeds\b/);
});

// The reason is how the app closed while they ran, as main's log says.
const WHY: [ClosedHow, string][] = [
  ['quit', 'when the app quit'],
  ['ended', 'when the app ended without quitting'],
  ['unknown', 'when the app last closed'],
];
for (const [lastClosed, said] of WHY) {
  test(`the mark says why, after a close the log calls ${lastClosed}`, async ({ app, page }) => {
    await app.boot({ ...fixture, lastClosed });
    await expect(tab(page, one.title).locator('.nudge')).toHaveAttribute('data-tooltip', `Needs you — was running ${said}`);
    expect(await app.calls('markNeedsYou')).toEqual([[[one.id, two.id, gone.id], [{ type: 'app.was-running', at: expect.any(Number), how: lastClosed }]]]);
  });
}

// A status file an end without a quit left behind would say busy or waiting, which show over the mark; the claude that wrote it has gone.
test('a session marked at launch forgets the status its file still held', async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [one.id]: 'busy', [three.id]: 'waiting' } });
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(tab(page, three.title).locator('.nudge')).toHaveClass(/\bwaiting\b/);
  expect(await app.calls('clearStatus')).toEqual(expect.arrayContaining([[one.id], [two.id], [gone.id]]));
  expect(await app.calls('clearStatus')).not.toContainEqual([three.id]);
});

// Kept per session: a launch that leaves a marked tab unopened leaves the next launch nothing running to mark, and the mark from before stays, with its reason.
test('a marked session left unopened through a launch is still marked at the next, with its first reason', async ({ app, page }) => {
  await app.boot({ ...fixture, runningSessions: [], needsYou: { [two.id]: [{ type: 'app.was-running', at: 1, how: 'ended' }] }, lastClosed: 'quit' });
  await expect(tab(page, two.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(tab(page, two.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — was running when the app ended without quitting');
  expect(await app.calls('markNeedsYou')).toEqual([]);
});

// A session keeps every reason it needs you for (decided 2026-10-29): a launch adds how the app closed beside a reminder that came due, and replaces only how it closed before.
test('a session that was running comes back with how the app closed beside its reminder, listed first', async ({ app, page }) => {
  const day = new Date(2026, 10, 2, 9).getTime();
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.reminder', at: day }], [two.id]: [{ type: 'app.was-running', at: 1, how: 'ended' }] } });
  await expect(tab(page, one.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit\nNeeds you — reminder for Mon 2 Nov, 09:00');
  await expect(tab(page, two.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit');
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.needsYou[window.__claudeUiFixture.sessions[0].id])).toEqual([
    { type: 'app.reminder', at: day },
    { type: 'app.was-running', at: expect.any(Number), how: 'quit' },
  ]);
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
  // A folder gone is not tried, and says nothing until its tab is selected; it is marked all the same.
  await expect(tab(page, gone.title)).toHaveClass(/\bcold\b/);
  await expect(tab(page, gone.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(page.locator('#toast')).toBeHidden();
  // Started, they keep the mark until a prompt there.
  expect(await app.calls('markNeedsYou')).toEqual([[[one.id, two.id, gone.id], [{ type: 'app.was-running', at: expect.any(Number), how: 'quit' }]]]);
  await expect(tab(page, two.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([all.map((s) => s.id), [one.id, two.id]]);

  // Out of sight, the second is sized to the terminal area as the one on show is, not left at xterm's 80 columns.
  const sizeOf = async (id: number): Promise<number[] | undefined> => (await sizes(app)).filter(([pty]) => pty === id).at(-1)?.slice(1);
  await expect.poll(() => sizeOf(2)).toBeDefined();
  const shown = (await sizeOf(1))!;
  expect(shown[0]).toBeGreaterThan(80);
  expect(await sizeOf(2)).toEqual(shown);
});

// Whether they are marked is the type's, switched off in `needsYou` (decided 2026-11-06, kept in settings.json since 2026-11-08).
test('with the type that marks them switched off, the sessions that were running come back cold with the other tabs, unmarked, and nothing starts', async ({ app, page }) => {
  await app.boot({ ...fixture, settings: needsYouFile(switchedOff('app.was-running')) });
  await expect(tab(page, one.title)).toHaveClass(/\bactive\b/);
  await expect.poll(() => app.calls('setOpenSessions')).toHaveLength(1);
  expect(await app.calls('startTerminal')).toEqual([]);
  expect((await app.calls('setOpenSessions')).at(-1)).toEqual([all.map((s) => s.id), []]);
  expect(await app.calls('markNeedsYou')).toEqual([]);
});

// The choices from while the setting also said whether they were marked, `pause` the oldest, which a settings.json written then holds.
for (const older of ['mark', 'pause', 'leave']) {
  test(`a settings.json that says "${older}" brings them back cold, marked`, async ({ app, page }) => {
    await app.boot(choosing(older as RunningAtLaunch));
    await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
    expect(await app.calls('startTerminal')).toEqual([]);
  });
}

// A set-aside mark set before the quit did not know of it, so the quit's mark shows in full and the session comes back as the others do, its bookmark kept (decided 2026-10-29).
test('a session set aside that was running comes back as the others do, marked and started as chosen, keeping its set-aside mark', async ({ app, page }) => {
  await app.boot({ ...choosing('start'), setAside: { [two.id]: { due: null, at: 1 } } });
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const launches = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launches.map(([, launch]) => launch.resumeSessionId)).toEqual([one.id, two.id]);
  expect(await app.calls('markNeedsYou')).toEqual([[[one.id, two.id, gone.id], [{ type: 'app.was-running', at: expect.any(Number), how: 'quit' }]]]);
  await expect(tab(page, two.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  await expect(tab(page, two.title).locator('.nudge')).not.toHaveClass(/\backed\b/);
  await expect(tab(page, two.title).locator('.tab-set-aside')).toBeVisible();
});

// Finished is put away, not resumed: a tab kept for one by an earlier version (finished while it ran, or opened as a sibling) is not brought back, even one that was running, and is no longer kept.
test('a finished session kept among the open tabs does not come back, and is dropped from them', async ({ app, page }) => {
  await app.boot({ ...choosing('start'), finished: { [two.id]: Date.parse('2026-10-01T08:00:00.000Z') } });
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(tab(page, one.title)).toBeVisible();
  await expect(tab(page, two.title)).toHaveCount(0);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(one.id);
  await expect.poll(async () => ((await app.calls('setOpenSessions')).at(-1) as string[][])[0]).not.toContain(two.id);
});
