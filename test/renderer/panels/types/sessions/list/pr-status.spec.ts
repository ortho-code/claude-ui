import type { Locator, Page } from '@playwright/test';
import type { PrStatus, SessionPr, SessionSummary } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { lookOf, token } from '../../../../support/looks';
import { row, tab } from '../../../../support/window';

// The window asks main what GitHub says of the PRs the sessions link: at launch, when a PR is linked, on a timer the answer sets, and when the window comes back into focus.
// A session's PR mark takes the colour its PRs roll up to, and its tooltip says what set it.
const MINUTE = 60_000;
const pr = (number: number): SessionPr => ({ repository: 'ScientaNL/demo', number, url: `https://github.com/ScientaNL/demo/pull/${number}` });
const ref = (number: number): { repository: string; number: number } => ({ repository: 'ScientaNL/demo', number });
const open = (checks: 'passed' | 'running' = 'passed'): Extract<PrStatus, { state: 'open' }> => ({ state: 'open', draft: false, review: 'review-required', checks, conflict: false });

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

const marked = (id: string, title: string, ...numbers: number[]): SessionSummary => session({ id: `00000000-0000-4000-8000-0000000000f${id}`, title, prs: numbers.map(pr) });
const failing = marked('1', 'Failing beside merged', 12, 7);
const asked = marked('2', 'Changes asked', 3);
const ready = marked('3', 'Ready to merge', 4);
const waiting = marked('4', 'Waiting for review', 5);
const done = marked('5', 'All done', 6, 8);
const states = {
  sessions: [failing, asked, ready, waiting, done],
  history: Object.fromEntries([failing, asked, ready, waiting, done].map((s) => [s.id, []])),
  prStatuses: {
    'ScientaNL/demo#12': { ...open(), checks: 'failed' },
    'ScientaNL/demo#7': { state: 'merged' },
    'ScientaNL/demo#3': { ...open(), review: 'changes-requested' },
    'ScientaNL/demo#4': { ...open(), review: 'approved' },
    'ScientaNL/demo#5': open(),
    'ScientaNL/demo#6': { state: 'merged' },
    'ScientaNL/demo#8': { state: 'closed' },
  } satisfies Record<string, PrStatus>,
};
const mark = (page: Page, title: string): Locator => row(page, title).locator('.pr-badge');

test("a session's PR mark takes the colour its PRs roll up to, outline and count alike, and its tooltip says what set it", async ({ app, page }) => {
  await app.boot(states);
  const expected: [title: string, colour: string, says: string][] = [
    [failing.title, '--failed', '2 PRs linked to this session — 1 with failing checks — click to list them'],
    [asked.title, '--waiting', '1 PR linked to this session — 1 with changes requested — click to list them'],
    [ready.title, '--idle', '1 PR linked to this session — 1 approved — click to list them'],
    [waiting.title, '--accent', '1 PR linked to this session — 1 awaiting review — click to list them'],
    [done.title, '--muted', '2 PRs linked to this session — 1 merged, 1 closed — click to list them'],
  ];
  for (const [title, colour, says] of expected) {
    await expect(mark(page, title)).toHaveAttribute('data-tooltip', says);
    const look = await lookOf(mark(page, title));
    expect(look.color).toBe(await token(page, colour));
    expect(look.border).toBe(await token(page, colour));
  }
});

test("a PR mark fills with its own colour on hover, as the accent's fills", async ({ app, page }) => {
  await app.boot(states);
  await mark(page, failing.title).hover();
  expect((await lookOf(mark(page, failing.title))).background).toBe(await token(page, '--failed'));
  await mark(page, done.title).hover();
  expect((await lookOf(mark(page, done.title))).background).toBe(await token(page, '--muted'));
});

test('when main could not ask GitHub, every PR mark keeps the accent and says why, whatever statuses come with the problem', async ({ app, page }) => {
  await app.boot({ ...states, prProblem: 'gh is not logged in; run gh auth login' });
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — no status: gh is not logged in; run gh auth login — click to list them');
  expect((await lookOf(mark(page, failing.title))).color).toBe(await token(page, '--accent'));
  expect((await lookOf(mark(page, done.title))).color).toBe(await token(page, '--accent'));
});

test("a PR mark follows GitHub's next answer", async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, prStatuses: { 'ScientaNL/demo#12': open('running'), 'ScientaNL/demo#7': { state: 'merged' } } });
  await expect(mark(page, two.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with checks running — click to list them');
  await gitHubSays(page, { 'ScientaNL/demo#12': { ...open(), checks: 'failed' }, 'ScientaNL/demo#7': { state: 'merged' } });
  await page.clock.fastForward(MINUTE);
  await expect(mark(page, two.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with failing checks — click to list them');
  expect((await lookOf(mark(page, two.title))).color).toBe(await token(page, '--failed'));
});

const items = (page: Page, menu = '.kebab-menu'): Locator => page.locator(`${menu} button`);
const dotColours = (list: Locator): Promise<string[]> => list.locator('.nudge').evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).backgroundColor));

test("each PR in a mark's list and in a tab's options says its state, led by a dot in its own ink", async ({ app, page }) => {
  await app.boot({ ...states, openSessions: [failing.id] });
  await mark(page, failing.title).click();
  await expect(items(page)).toHaveText(['ScientaNL/demo#12 · checks failed', 'ScientaNL/demo#7 · merged']);
  expect(await dotColours(items(page))).toEqual([await token(page, '--failed'), await token(page, '--muted')]);
  await mark(page, failing.title).click();

  await tab(page, failing.title).locator('.tab-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'PRs (2)' }).click();
  const submenu = items(page, '.kebab-menu.submenu');
  await expect(submenu).toHaveText(['ScientaNL/demo#12 · checks failed', 'ScientaNL/demo#7 · merged']);
  expect(await dotColours(submenu)).toEqual([await token(page, '--failed'), await token(page, '--muted')]);
});

test('a PR with no status is listed by its reference alone, with a hollow dot', async ({ app, page }) => {
  await app.boot({ ...states, prStatuses: {} });
  await mark(page, failing.title).click();
  await expect(items(page)).toHaveText(['ScientaNL/demo#12', 'ScientaNL/demo#7']);
  await expect(items(page).locator('.nudge')).toHaveClass(['nudge single', 'nudge single']);
});

test('while main could not ask GitHub, every PR is listed as one with no status, whatever statuses come with the problem', async ({ app, page }) => {
  await app.boot({ ...states, prProblem: 'gh was not found' });
  await mark(page, failing.title).click();
  await expect(items(page)).toHaveText(['ScientaNL/demo#12', 'ScientaNL/demo#7']);
  await expect(items(page).locator('.nudge')).toHaveClass(['nudge single', 'nudge single']);
});
