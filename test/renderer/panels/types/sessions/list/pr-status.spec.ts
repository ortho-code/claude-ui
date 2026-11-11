import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../../../../src/shared/config/settings';
import type { PrStatus, SessionPr, SessionSummary } from '../../../../../../src/shared/types';
import { session, settingsFileWith } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { lookOf, token } from '../../../../support/looks';
import { needsYouFile } from '../../../../support/needs-you';
import { openSettings } from '../../../../support/settings';
import { row, tab } from '../../../../support/window';

// The window asks main what GitHub says of the PRs the sessions link: at launch, when a PR is linked, on a timer the answer sets, and when the window comes back into focus.
// A session's PR mark takes the colour its PRs roll up to, and its tooltip says what set it.
// Main answers each PR's status under its key, the reference in lower case (`prKey`), while the window shows each as the session spells it.
const MINUTE = 60_000;
const pr = (number: number): SessionPr => ({ repository: 'ScientaNL/demo', number, url: `https://github.com/ScientaNL/demo/pull/${number}` });
const ref = (number: number): { repository: string; number: number } => ({ repository: 'ScientaNL/demo', number });
const open = (checks: 'passed' | 'running' = 'passed'): Extract<PrStatus, { state: 'open' }> => ({
  state: 'open',
  role: 'own',
  draft: false,
  review: 'review-required',
  checks,
  conflict: false,
  approvals: 0,
  newCommits: false,
  reviewAsked: false,
  changesRequested: [],
});

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
  await app.boot({ ...fixture, prStatuses: { 'scientanl/demo#12': open('running'), 'scientanl/demo#7': { state: 'merged', role: 'own' } } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);

  await gitHubSays(page, { 'scientanl/demo#12': open(), 'scientanl/demo#7': { state: 'merged', role: 'own' } });
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(3);
  await page.clock.fastForward(4 * MINUTE);
  expect(await app.calls('prStatuses')).toHaveLength(3);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(4);

  await gitHubSays(page, { 'scientanl/demo#12': { state: 'merged', role: 'own' }, 'scientanl/demo#7': { state: 'merged', role: 'own' } });
  await page.clock.fastForward(5 * MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(5);
  await page.clock.fastForward(60 * MINUTE);
  expect(await app.calls('prStatuses')).toHaveLength(5);
});

test('the window coming back into focus asks again, once the last answer is a minute old', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, prStatuses: { 'scientanl/demo#12': { state: 'merged', role: 'own' }, 'scientanl/demo#7': { state: 'merged', role: 'own' } } });
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
    'scientanl/demo#12': { ...open(), checks: 'failed' },
    'scientanl/demo#7': { state: 'merged', role: 'own' },
    'scientanl/demo#3': { ...open(), review: 'changes-requested' },
    'scientanl/demo#4': { ...open(), review: 'approved' },
    'scientanl/demo#5': open(),
    'scientanl/demo#6': { state: 'merged', role: 'own' },
    'scientanl/demo#8': { state: 'closed', role: 'own' },
  } satisfies Record<string, PrStatus>,
};
const mark = (page: Page, title: string): Locator => row(page, title).locator('.pr-badge');

test("a session's PR mark takes the colour its PRs roll up to, outline and count alike, and its tooltip says what set it", async ({ app, page }) => {
  await app.boot(states);
  const expected: [title: string, colour: string, says: string][] = [
    [failing.title, '--failed', '2 PRs linked to this session — 1 with failing checks — click to list them'],
    [asked.title, '--waiting', '1 PR linked to this session — 1 with changes requested — click to list them'],
    [ready.title, '--ready', '1 PR linked to this session — 1 approved — click to list them'],
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
  await app.boot({ ...fixture, prStatuses: { 'scientanl/demo#12': open('running'), 'scientanl/demo#7': { state: 'merged', role: 'own' } } });
  await expect(mark(page, two.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with checks running — click to list them');
  await gitHubSays(page, { 'scientanl/demo#12': { ...open(), checks: 'failed' }, 'scientanl/demo#7': { state: 'merged', role: 'own' } });
  await page.clock.fastForward(MINUTE);
  await expect(mark(page, two.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with failing checks — click to list them');
  expect((await lookOf(mark(page, two.title))).color).toBe(await token(page, '--failed'));
});

/** settings.json with PR status on or off. */
const prStatusIs = (on: boolean): SettingsFileRead => settingsFileWith('settings.json', { prStatus: on });

/** Tick or untick PR status in Settings and save. */
async function saveWith(page: Page, on: boolean): Promise<void> {
  const dialog = await openSettings(page, 'Version control');
  await dialog.getByRole('switch', { name: 'PR status from GitHub' }).setChecked(on);
  await dialog.getByRole('button', { name: 'Save' }).click();
}

test('with PR status off in the settings, the window asks GitHub nothing, from launch on, and every mark keeps the accent', async ({ app, page }) => {
  await app.boot({ ...states, settings: prStatusIs(false) });
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — click to list them');
  expect((await lookOf(mark(page, failing.title))).color).toBe(await token(page, '--accent'));
  expect(await app.calls('prStatuses')).toEqual([]);
});

test('switching PR status on asks at once, and switching it off again takes every colour away', async ({ app, page }) => {
  await app.boot({ ...states, settings: prStatusIs(false) });
  await expect(mark(page, failing.title)).toBeVisible();
  await app.settingsOnDisk(prStatusIs(true));
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with failing checks — click to list them');

  await app.settingsOnDisk(prStatusIs(false));
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — click to list them');
  expect((await lookOf(mark(page, failing.title))).color).toBe(await token(page, '--accent'));
  expect(await app.calls('prStatuses')).toHaveLength(1);
});

test('switching PR status off in Settings stops the asking and takes every colour away at once, and switching it on there asks at once', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...states, prStatuses: { ...states.prStatuses, 'scientanl/demo#5': open('running') } });
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with failing checks — click to list them');

  await saveWith(page, false);
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — click to list them');
  expect((await lookOf(mark(page, failing.title))).color).toBe(await token(page, '--accent'));
  // A PR's checks were running, which asks again in a minute: off, nothing does.
  await page.clock.fastForward(5 * MINUTE);
  expect(await app.calls('prStatuses')).toHaveLength(1);

  await saveWith(page, true);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with failing checks — click to list them');
});

test('a change main read before a save and told of after it leaves the save in force', async ({ app, page }) => {
  await app.boot(states);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  // Main's read for a change on disk, started while PR status was still on, and sent only once the save has been answered.
  const readBefore = await page.evaluate(() => window.__claudeUiTest.readSettings());
  await saveWith(page, false);
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — click to list them');

  await app.emit('onSettingsChanged', readBefore);
  await expect(mark(page, failing.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — click to list them');
  expect(await app.calls('prStatuses')).toHaveLength(1);
});

const items = (page: Page, menu = '.kebab-menu'): Locator => page.locator(`${menu} button`);
const dotColours = (list: Locator): Promise<string[]> => list.locator('.nudge').evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).backgroundColor));
/** Each item's two lines: the PR's reference, and what is said of it under it, null where nothing is. */
const lines = (list: Locator): Promise<[string | null, string | null][]> =>
  list.evaluateAll((buttons) => buttons.map((button) => [button.querySelector('.menu-item-label')?.textContent ?? null, button.querySelector('.menu-item-detail')?.textContent ?? null]));

test("each PR in a mark's list and in a tab's options says its state on a line under it, led by a dot in its own ink", async ({ app, page }) => {
  await app.boot({ ...states, openSessions: [failing.id] });
  await mark(page, failing.title).click();
  await expect(items(page)).toHaveCount(2);
  expect(await lines(items(page))).toEqual([
    ['#12', 'ScientaNL/demo · checks failed'],
    ['#7', 'ScientaNL/demo · merged'],
  ]);
  expect(await dotColours(items(page))).toEqual([await token(page, '--failed'), await token(page, '--muted')]);
  await mark(page, failing.title).click();

  await tab(page, failing.title).locator('.tab-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'PRs (2)' }).click();
  const submenu = items(page, '.kebab-menu.submenu');
  await expect(submenu).toHaveCount(2);
  expect(await lines(submenu)).toEqual([
    ['#12', 'ScientaNL/demo · checks failed'],
    ['#7', 'ScientaNL/demo · merged'],
  ]);
  expect(await dotColours(submenu)).toEqual([await token(page, '--failed'), await token(page, '--muted')]);
});

/** settings.json with the approvals a repository needs; the PRs here spell it `ScientaNL/demo`. */
const needsTwo = settingsFileWith('settings.json', { approvals: { 'scientanl/demo': 2 } });
const oneApproval = { ...states, prStatuses: { ...states.prStatuses, 'scientanl/demo#4': { ...open(), review: 'approved', approvals: 1 } } satisfies Record<string, PrStatus> };

test('a PR GitHub calls approved stays the accent, awaiting review, below the approvals its repository needs, and turns green once the setting asks no more', async ({ app, page }) => {
  await app.boot({ ...oneApproval, settings: needsTwo });
  await expect(mark(page, ready.title)).toHaveAttribute('data-tooltip', '1 PR linked to this session — 1 awaiting review — click to list them');
  expect((await lookOf(mark(page, ready.title))).color).toBe(await token(page, '--accent'));

  await app.settingsOnDisk(settingsFileWith('settings.json', {}));
  await expect(mark(page, ready.title)).toHaveAttribute('data-tooltip', '1 PR linked to this session — 1 approved — click to list them');
  expect((await lookOf(mark(page, ready.title))).color).toBe(await token(page, '--ready'));
});

test("a PR's list item names someone else's PR by your role, and counts an open PR's approvals against its repository's number", async ({ app, page }) => {
  const theirs = marked('6', 'Reviewing theirs', 9, 10);
  await app.boot({
    ...oneApproval,
    sessions: [...oneApproval.sessions, theirs],
    history: { ...oneApproval.history, [theirs.id]: [] },
    prStatuses: { ...oneApproval.prStatuses, 'scientanl/demo#9': { ...open(), role: 'reviewing', review: 'changes-requested', approvals: 1 }, 'scientanl/demo#10': { state: 'merged', role: 'other' } },
    settings: needsTwo,
  });
  await mark(page, theirs.title).click();
  await expect(items(page)).toHaveCount(2);
  expect(await lines(items(page))).toEqual([
    ['#9', 'ScientaNL/demo · reviewing · changes requested · waiting on the author · 1 of 2 approvals'],
    ['#10', 'ScientaNL/demo · someone else’s · merged'],
  ]);
  // Neither line is cut: the longest still fits the menu's width, the line under the reference wrapping where it would not.
  const cut = await items(page).evaluateAll((buttons) => buttons.flatMap((button) => [...button.querySelectorAll<HTMLElement>('.menu-item-label, .menu-item-detail')]).filter((line) => line.scrollWidth > line.clientWidth).length);
  expect(cut).toBe(0);
  await mark(page, theirs.title).click();

  await mark(page, ready.title).click();
  await expect(items(page)).toHaveCount(1);
  expect(await lines(items(page))).toEqual([['#4', 'ScientaNL/demo · review required · 1 of 2 approvals']]);
});

// Whose turn a PR's state is follows the needs-you types' roles: as shipped, a conflict, failing checks, changes requested and approved are the author's, and new commits since your review and your review asked are yours on a PR you review.
const theirs = marked('8', 'Theirs to fix', 30);
const yoursAgain = marked('9', 'Yours to review again', 31, 30);
const turns = {
  sessions: [theirs, yoursAgain],
  history: { [theirs.id]: [], [yoursAgain.id]: [] },
  prStatuses: {
    'scientanl/demo#30': { ...open(), role: 'reviewing', conflict: true, newCommits: false },
    'scientanl/demo#31': { ...open(), role: 'reviewing', newCommits: true },
  } satisfies Record<string, PrStatus>,
};

test("a PR whose state is the author's to act on keeps the accent and says who it waits on", async ({ app, page }) => {
  await app.boot(turns);
  await expect(mark(page, theirs.title)).toHaveAttribute('data-tooltip', '1 PR linked to this session — 1 waiting on the author — click to list them');
  expect((await lookOf(mark(page, theirs.title))).color).toBe(await token(page, '--accent'));
  await mark(page, theirs.title).click();
  expect(await lines(items(page))).toEqual([['#30', 'ScientaNL/demo · reviewing · merge conflict · waiting on the author']]);
  expect(await dotColours(items(page))).toEqual([await token(page, '--accent')]);
});

test('a PR yours to review again takes the colour of the needs-you type that says so, on its mark and its dot, and follows a look set for that type', async ({ app, page }) => {
  await app.boot({ ...turns, settings: settingsFileWith('settings.json', { looks: { 'pr.new-commits': { colour: '#123456' } } }) });
  await expect(mark(page, yoursAgain.title)).toHaveAttribute('data-tooltip', '2 PRs linked to this session — 1 with new commits since your review — click to list them');
  expect((await lookOf(mark(page, yoursAgain.title))).color).toBe('rgb(18, 52, 86)');
  await mark(page, yoursAgain.title).click();
  expect(await lines(items(page))).toEqual([
    ['#31', 'ScientaNL/demo · reviewing · new commits since your review'],
    ['#30', 'ScientaNL/demo · reviewing · merge conflict · waiting on the author'],
  ]);
  expect(await dotColours(items(page))).toEqual(['rgb(18, 52, 86)', await token(page, '--accent')]);
  // The dot takes the look's colour alone: a needs-you look pulses, a PR's dot in a menu stays still.
  expect(await items(page).first().locator('.nudge').evaluate((dot) => getComputedStyle(dot).animationName)).toBe('none');
});

test('a PR you review that is ready to merge turns green once its type fires for reviewers too', async ({ app, page }) => {
  const ready = marked('a', 'Theirs approved', 32);
  await app.boot({ sessions: [ready], history: { [ready.id]: [] }, prStatuses: { 'scientanl/demo#32': { ...open(), role: 'reviewing', review: 'approved', approvals: 1 } } });
  await expect(mark(page, ready.title)).toHaveAttribute('data-tooltip', '1 PR linked to this session — 1 waiting on the author — click to list them');
  await app.settingsOnDisk(needsYouFile({ 'pr.approved': { roles: ['own', 'reviewing'] } }));
  await expect(mark(page, ready.title)).toHaveAttribute('data-tooltip', '1 PR linked to this session — 1 approved — click to list them');
  expect((await lookOf(mark(page, ready.title))).color).toBe(await token(page, '--ready'));
});

test('a PR with no status is listed by its number and repository alone, with a hollow dot', async ({ app, page }) => {
  await app.boot({ ...states, prStatuses: {} });
  await mark(page, failing.title).click();
  await expect(items(page)).toHaveCount(2);
  expect(await lines(items(page))).toEqual([
    ['#12', 'ScientaNL/demo'],
    ['#7', 'ScientaNL/demo'],
  ]);
  await expect(items(page).locator('.nudge')).toHaveClass(['nudge single', 'nudge single']);
});

test('while main could not ask GitHub, every PR is listed as one with no status, whatever statuses come with the problem', async ({ app, page }) => {
  await app.boot({ ...states, prProblem: 'gh was not found' });
  await mark(page, failing.title).click();
  await expect(items(page)).toHaveCount(2);
  expect(await lines(items(page))).toEqual([
    ['#12', 'ScientaNL/demo'],
    ['#7', 'ScientaNL/demo'],
  ]);
  await expect(items(page).locator('.nudge')).toHaveClass(['nudge single', 'nudge single']);
});

const jan = { login: 'jan', name: 'Jan Jansen' };
const titled = marked('7', 'Titled PRs', 21, 22);
const titledFixture = {
  sessions: [titled],
  history: { [titled.id]: [] },
  prStatuses: {
    'scientanl/demo#21': { ...open(), title: 'Scheduler tick per host' },
    'scientanl/demo#22': { state: 'merged', role: 'reviewing', title: `A title long enough to wrap in a menu ${'that is at most 300px wide '.repeat(2)}`.trim(), author: jan },
  } satisfies Record<string, PrStatus>,
};

test("a PR is listed by its number and title, a long one wrapping rather than cut, and one not yours by who opened it", async ({ app, page }) => {
  await app.boot(titledFixture);
  await mark(page, titled.title).click();
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).first().locator('.menu-item-label')).toHaveText('#21 · Scheduler tick per host');
  expect(await lines(items(page))).toEqual([
    ['#21 · Scheduler tick per host', 'ScientaNL/demo · review required'],
    [`#22 · ${titledFixture.prStatuses['scientanl/demo#22'].title}`, 'ScientaNL/demo · by Jan Jansen · reviewing · merged'],
  ]);
  const cut = await items(page).evaluateAll((buttons) => buttons.flatMap((button) => [...button.querySelectorAll<HTMLElement>('.menu-item-label')]).filter((line) => line.scrollWidth > line.clientWidth).length);
  expect(cut).toBe(0);
  const heights = await items(page).locator('.menu-item-label').evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().height));
  // The long title takes more than the one line the short one does.
  expect(heights[1]).toBeGreaterThan(1.5 * heights[0]);
});

test('a PR keeps the repository in front of its number where the session links PRs in several', async ({ app, page }) => {
  const spread = session({ id: '00000000-0000-4000-8000-0000000000f8', title: 'Two repositories', prs: [pr(21), { repository: 'ScientaNL/site', number: 3, url: 'https://github.com/ScientaNL/site/pull/3' }] });
  await app.boot({ ...titledFixture, sessions: [spread], history: { [spread.id]: [] } });
  await mark(page, spread.title).click();
  await expect(items(page)).toHaveCount(2);
  expect(await lines(items(page))).toEqual([
    ['ScientaNL/demo#21 · Scheduler tick per host', 'review required'],
    ['ScientaNL/site#3', null],
  ]);
});

test('a PR is named by the title last seen from launch on, before GitHub answers', async ({ app, page }) => {
  await app.boot({ ...titledFixture, prStatuses: {}, prSeen: { 'scientanl/demo#21': { ...open(), title: 'Seen before' } } });
  await mark(page, titled.title).click();
  await expect(items(page).first().locator('.menu-item-label')).toHaveText('#21 · Seen before');
});

test("typing words of a linked PR's title finds its session", async ({ app, page }) => {
  await app.boot({ ...titledFixture, sessions: [titled, none], history: { [titled.id]: [], [none.id]: [] } });
  await expect(row(page, none.title)).toBeVisible();
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('tick per host');
  await expect(row(page, none.title)).toBeHidden();
  await expect(row(page, titled.title)).toBeVisible();
});

// A PR opened in the browser with `gh pr create --web` exists only once it is submitted there, so the window looks for it until it does, and links it to the session that opened it.
const COMMAND_AT = '2026-11-09T09:21:32.000Z';
const opener = session({ id: '00000000-0000-4000-8000-0000000000fb', title: 'Opened a PR in the browser', webCreates: [{ repository: 'ScientaNL/demo', head: 'me:fix', at: COMMAND_AT }] });
const createdUrl = 'https://github.com/ScientaNL/demo/pull/40';

test('a PR opened in the browser is looked for every five minutes, linked to its session once it exists, and then asked about as any other', async ({ app, page }) => {
  await page.clock.install({ time: new Date('2026-11-09T09:22:00.000Z') });
  await app.boot({ sessions: [opener], history: { [opener.id]: [] }, prStatuses: { 'scientanl/demo#40': { ...open(), title: 'Fix the thing' } } });
  await expect.poll(() => app.calls('findCreatedPrs')).toEqual([[[{ id: opener.id, repository: 'ScientaNL/demo', head: 'me:fix', at: COMMAND_AT }]]]);
  await expect(mark(page, opener.title)).toBeHidden();

  // Submitted in the browser.
  await page.evaluate((url) => void (window.__claudeUiFixture.createdPrs['ScientaNL/demo\nme:fix'] = url), createdUrl);
  await page.clock.fastForward(5 * MINUTE);
  await expect(mark(page, opener.title)).toHaveText('1');
  await expect.poll(() => app.calls('prStatuses')).toEqual([[[ref(40)]]]);
  await mark(page, opener.title).click();
  expect(await lines(items(page))).toEqual([['#40 · Fix the thing', 'ScientaNL/demo · review required']]);
  await mark(page, opener.title).click();

  // Found, it is looked for no more.
  await page.clock.fastForward(5 * MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);
  expect(await app.calls('findCreatedPrs')).toHaveLength(2);
});

test('a PR opened in the browser is looked for no longer than 30 days after the command', async ({ app, page }) => {
  await page.clock.install({ time: new Date('2026-12-09T09:21:00.000Z') });
  await app.boot({ sessions: [opener], history: { [opener.id]: [] } });
  await expect.poll(() => app.calls('findCreatedPrs')).toHaveLength(1);
  await page.clock.fastForward(5 * MINUTE);
  expect(await app.calls('findCreatedPrs')).toHaveLength(1);
});

test('with PR status off, a PR opened in the browser is not looked for', async ({ app, page }) => {
  await page.clock.install({ time: new Date('2026-11-09T09:22:00.000Z') });
  await app.boot({ sessions: [opener], history: { [opener.id]: [] }, settings: prStatusIs(false) });
  await expect(row(page, opener.title)).toBeVisible();
  await page.clock.fastForward(5 * MINUTE);
  expect(await app.calls('findCreatedPrs')).toEqual([]);
});
