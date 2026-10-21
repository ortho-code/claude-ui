import type { Page } from '@playwright/test';
import type { PrStatus, SessionPr } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// The window asks main what GitHub says of the PRs the sessions link: at launch, when a PR is linked, on a timer the answer sets, and when the window comes back into focus.
const MINUTE = 60_000;
const pr = (number: number): SessionPr => ({ repository: 'ScientaNL/demo', number, url: `https://github.com/ScientaNL/demo/pull/${number}` });
const ref = (number: number): { repository: string; number: number } => ({ repository: 'ScientaNL/demo', number });
const open = (checks: 'passed' | 'running' = 'passed'): PrStatus => ({ state: 'open', draft: false, review: 'review-required', checks, conflict: false });

/** What GitHub says of the PRs from now on, as main would find it on its next ask. */
const gitHubSays = (page: Page, statuses: Record<string, PrStatus>): Promise<void> => page.evaluate((now) => void (window.__claudeUiFixture.prStatuses = now), statuses);

const two = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Linked two PRs', prs: [pr(12), pr(7)] });
const again = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Linked one of them again', prs: [pr(7)] });
const none = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'Linked none' });
const fixture = { sessions: [two, again, none], history: { [two.id]: [], [again.id]: [], [none.id]: [] } };

test('the window asks once at launch about every linked PR, each once', async ({ app }) => {
  await app.boot(fixture);
  await expect.poll(() => app.calls('prStatuses')).toEqual([[[ref(12), ref(7)]]]);
});

test('a listing without a linked PR asks nothing', async ({ app, page }) => {
  await app.boot({ sessions: [none], history: { [none.id]: [] } });
  await expect(row(page, none.title)).toBeVisible();
  expect(await app.calls('prStatuses')).toEqual([]);
});

test('a newly linked PR is asked about, and a listing that links nothing new asks nothing, though it names them in another order', async ({ app }) => {
  await app.boot(fixture);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  // #7 is now named first: the PRs are the same.
  await app.listOnDisk([again, { ...two, title: 'Renamed' }, none]);
  await app.listOnDisk([two, again, { ...none, prs: [pr(20)] }]);
  await expect.poll(() => app.calls('prStatuses')).toEqual([[[ref(12), ref(7)]], [[ref(12), ref(7), ref(20)]]]);
});

test('the answer sets the next ask: a minute while checks run, five while a PR is open, none once all are merged', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, prStatuses: { 'ScientaNL/demo#12': open('running'), 'ScientaNL/demo#7': { state: 'merged' } } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);

  await gitHubSays(page, { 'ScientaNL/demo#12': open(), 'ScientaNL/demo#7': { state: 'merged' } });
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(3);
  await page.clock.fastForward(4 * MINUTE);
  expect(await app.calls('prStatuses')).toHaveLength(3);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(4);

  await gitHubSays(page, { 'ScientaNL/demo#12': { state: 'merged' }, 'ScientaNL/demo#7': { state: 'merged' } });
  await page.clock.fastForward(5 * MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(5);
  await page.clock.fastForward(60 * MINUTE);
  expect(await app.calls('prStatuses')).toHaveLength(5);
});

test('the window coming back into focus asks again, once the last answer is a minute old', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, prStatuses: { 'ScientaNL/demo#12': { state: 'merged' }, 'ScientaNL/demo#7': { state: 'merged' } } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  const focus = (): Promise<void> => page.evaluate(() => void window.dispatchEvent(new Event('focus')));
  await focus();
  await page.clock.fastForward(30_000);
  expect(await app.calls('prStatuses')).toHaveLength(1);
  await page.clock.fastForward(30_000);
  await focus();
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);
});
