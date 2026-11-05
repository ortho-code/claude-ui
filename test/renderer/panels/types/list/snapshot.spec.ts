import type { Page } from '@playwright/test';
import type { SessionsSnapshot } from '../../../../../src/renderer/panels/snapshot';
import { PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { bootList, print, type PrintedList } from './list';

// A list panel's run is given the sessions the app has, in a file of its own, and `watch: sessions` runs it again once that would say something new (docs/panel-types.md § The sessions).
const asked = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Review #1', prs: [{ repository: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1' }] });
const quiet = session({ id: '00000000-0000-4000-8000-0000000000b1', title: '', firstMessage: 'Speed up the search' });
const shelved = session({ id: '00000000-0000-4000-8000-0000000000b3', title: 'Archived' });
const REASON = { reason: 'pr' as const, at: 1_000, pr: 'acme/app#1', changes: ['merged' as const] };
const SET_ASIDE = { due: null, at: 2_000 };
const more = {
  sessions: [asked, quiet, shelved],
  archived: { [shelved.id]: 1 },
  statuses: { [asked.id]: 'waiting', [quiet.id]: 'start' },
  needsYou: { [asked.id]: [REASON] },
  setAside: { [quiet.id]: SET_ASIDE },
  groupState: { groups: [{ id: 'g1', name: 'Reviews', repoRoot: PROJECT }], groupOf: { [asked.id]: 'g1' } },
  // Already seen as it is, so the first answer marks nothing new.
  prSeen: { 'acme/app#1': { state: 'merged' as const } },
  prStatuses: { 'acme/app#1': { state: 'merged' as const } },
  history: { [asked.id]: [], [quiet.id]: [], [shelved.id]: [] },
};
const LIST: PrintedList = { version: 1, sections: [{ items: [{ key: 'one', text: 'One' }] }] };

const snapshotOf = async (app: App, index: number): Promise<SessionsSnapshot> => JSON.parse((await runs(app, 'changes'))[index].sessions ?? 'null') as SessionsSnapshot;

test('a run is given every session not archived, by id, with its title, project, group, status, read mark, needs-you and set-aside marks and PRs', async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  // Pressed until GitHub's answer, which the first run may come before, is in the snapshot.
  await expect
    .poll(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      return (await snapshotOf(app, -1 + (await runs(app, 'changes')).length)).sessions[1]?.prs[0]?.status;
    })
    .toEqual({ state: 'merged' });
  const { length } = await runs(app, 'changes');
  expect(await snapshotOf(app, length - 1)).toEqual({
    version: 1,
    sessions: [
      // A status the docs do not name, such as the marker a starting claude sends, is no status.
      { id: quiet.id, title: 'Speed up the search', project: PROJECT, group: null, status: null, read: false, needsYou: [], setAside: SET_ASIDE, prs: [] },
      { id: asked.id, title: 'Review #1', project: PROJECT, group: { id: 'g1', name: 'Reviews' }, status: 'waiting', read: false, needsYou: [REASON], setAside: null, prs: [{ ...asked.prs[0], status: { state: 'merged' } }] },
    ],
  });
});

/** Boot with the panel watching sessions and its first run ended, the clock in the check's hands. */
async function bootWatching(app: App, page: Page): Promise<void> {
  await page.clock.install();
  await bootList(app, page, LIST, { entry: { options: { watch: 'sessions' } }, more: { ...more, prStatuses: {}, prSeen: null } });
}

test('watching sessions, a change runs the panel again once nothing more has changed for 2 seconds, with the new snapshot', async ({ app, page }) => {
  await bootWatching(app, page);
  await app.emit('onSessionStatus', asked.id, 'idle', '', 'Stop');
  await page.clock.fastForward(1_500);
  await app.emit('onSessionStatus', quiet.id, 'busy', '', 'UserPromptSubmit');
  await page.clock.fastForward(1_500);
  expect(await runs(app, 'changes')).toHaveLength(1);
  await page.clock.fastForward(600);
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  expect((await snapshotOf(app, 1)).sessions.map(({ status }) => status)).toEqual(['busy', 'idle']);
});

test('watching sessions, a change the snapshot does not show runs nothing', async ({ app, page }) => {
  await bootWatching(app, page);
  // An archived session is not in it.
  await app.emit('onSessionStatus', shelved.id, 'idle', '', 'Stop');
  await page.clock.fastForward(5_000);
  expect(await runs(app, 'changes')).toHaveLength(1);
});

test('watching sessions, a change while a run goes runs the panel again 2 seconds after that run ends', async ({ app, page }) => {
  await bootWatching(app, page);
  await app.emit('onSessionStatus', asked.id, 'idle', '', 'Stop');
  await page.clock.fastForward(2_100);
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);

  await app.emit('onSessionStatus', asked.id, 'waiting', '', 'Notification');
  await page.clock.fastForward(5_000);
  expect(await runs(app, 'changes')).toHaveLength(2);
  await print(app, 1, LIST);
  await page.clock.fastForward(2_100);
  await expect.poll(() => runs(app, 'changes')).toHaveLength(3);
  expect((await snapshotOf(app, 2)).sessions[1].status).toBe('waiting');
});

test('a panel not watching sessions is given them, and a change does not run it', async ({ app, page }) => {
  await page.clock.install();
  await bootList(app, page, LIST, { more: { ...more, prStatuses: {}, prSeen: null } });
  expect((await snapshotOf(app, 0)).sessions).toHaveLength(2);
  await app.emit('onSessionStatus', asked.id, 'idle', '', 'Stop');
  await page.clock.fastForward(5_000);
  expect(await runs(app, 'changes')).toHaveLength(1);
});
