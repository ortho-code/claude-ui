import type { Locator, Page } from '@playwright/test';
import type { PrStatus, SessionPr } from '../../../../../src/shared/types';
import { session, settingsFileWith } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { needsYouFile, switchedOff } from '../../../support/needsyou';
import { row, tab, tabLabels } from '../../../support/window';

// A linked PR changing in a way that needs you marks every session that links it as needing you, with that change as its reason, running or not, finished ones left out (decided 2026-10-29).
// What was last seen of each PR is kept in meta, so a change while the app was closed marks at the next launch; the first run marks only the sessions set aside to wait.
const MINUTE = 60_000;
const pr = (number: number, repository = 'acme/app'): SessionPr => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });
const open = (overrides: Partial<Extract<PrStatus, { state: 'open' }>> = {}): PrStatus => ({
  state: 'open',
  role: 'own',
  draft: false,
  review: 'review-required',
  checks: 'passed',
  conflict: false,
  approvals: 0,
  newCommits: false,
  reviewAsked: false,
  changesRequested: [],
  ...overrides,
});

const cold = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Cold tab', prs: [pr(7)] });
const closed = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'No tab', prs: [pr(7)] });
const shelved = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Archived', prs: [pr(7)] });
const other = session({ id: '00000000-0000-4000-8000-0000000000f4', title: 'Other PR', prs: [pr(8)] });
const all = [cold, closed, shelved, other];
const seenOpen = { 'acme/app#7': open(), 'acme/app#8': open() };
const fixture = {
  sessions: all,
  openSessions: [cold.id],
  finished: { [shelved.id]: 1 },
  prSeen: seenOpen,
  prStatuses: { 'acme/app#7': open(), 'acme/app#8': open() },
  history: Object.fromEntries(all.map((s) => [s.id, []])),
};

/** What GitHub says of the PRs from now on, as main would find it on its next ask. */
const gitHubSays = (page: Page, statuses: Record<string, PrStatus>): Promise<void> => page.evaluate((now) => void (window.__claudeUiFixture.prStatuses = now), statuses);
/** Let the next ask come, five minutes on while a PR is open. */
const nextAsk = (page: Page): Promise<void> => page.clock.fastForward(5 * MINUTE);
const needs = (dot: Locator): Promise<void> => expect(dot).toHaveClass(/\bneeds\b/);
const notNeeds = (dot: Locator): Promise<void> => expect(dot).not.toHaveClass(/\bneeds\b/);

test('a linked PR merging marks every session that links it, with a tab or without, and not a finished one or another PR\'s', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await notNeeds(row(page, closed.title).locator('.nudge'));

  await gitHubSays(page, { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() });
  await nextAsk(page);
  for (const dot of [row(page, closed.title).locator('.nudge'), row(page, cold.title).locator('.nudge'), tab(page, cold.title).locator('.nudge')]) {
    await needs(dot);
    await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merged');
  }
  await notNeeds(row(page, other.title).locator('.nudge'));
  await expect.poll(() => page.evaluate(() => Object.keys(window.__claudeUiFixture.needsYou).sort())).toEqual([cold.id, closed.id].sort());
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen?.['acme/app#7'])).toEqual({ state: 'merged', role: 'own' });
});

test('a PR two sessions spell with other capitals is asked once, and its change marks both', async ({ app, page }) => {
  await page.clock.install();
  const shouted = session({ id: '00000000-0000-4000-8000-0000000000f5', title: 'Shouted', prs: [pr(7, 'Acme/App')] });
  await app.boot({ ...fixture, sessions: [closed, shouted], openSessions: [], finished: {}, history: { [closed.id]: [], [shouted.id]: [] } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  const [[asked]] = (await app.calls('prStatuses')) as [SessionPr[]][];
  expect(asked).toEqual([{ repository: 'acme/app', number: 7 }]);

  await gitHubSays(page, { 'acme/app#7': { state: 'merged', role: 'own' } });
  await nextAsk(page);
  await needs(row(page, closed.title).locator('.nudge'));
  await needs(row(page, shouted.title).locator('.nudge'));
  // Each names the PR as it spells it, and what was seen is kept once, by key.
  await expect(row(page, shouted.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merged');
  await expect.poll(() => page.evaluate(() => Object.keys(window.__claudeUiFixture.prSeen ?? {}))).toEqual(['acme/app#7', 'acme/app#8']);
});

test('a running session is marked too, and a prompt there takes it off', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture);
  await tabLabels(page).filter({ hasText: cold.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await app.emit('onSessionStatus', cold.id, 'idle', '', 'Stop');

  await gitHubSays(page, { 'acme/app#7': open({ review: 'changes-requested' }), 'acme/app#8': open() });
  await nextAsk(page);
  await needs(tab(page, cold.title).locator('.nudge'));
  // The tooltip lists every state, the one the dot shows first (decided 2026-11-06).
  await expect(tab(page, cold.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 changes requested\nIdle');
  await app.emit('onSessionStatus', cold.id, 'busy', '', 'UserPromptSubmit');
  await notNeeds(tab(page, cold.title).locator('.nudge'));
});

// Every change of one answer is a reason of its own type, at the same moment, and the dot names them together (decided 2026-11-06).
test('a PR turning approved with failing checks marks a reason for each, named together on one line', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);

  await gitHubSays(page, { 'acme/app#7': open({ review: 'approved', checks: 'failed' }), 'acme/app#8': open() });
  await nextAsk(page);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 checks failed, approved');
  const at = expect.any(Number);
  await expect.poll(() => page.evaluate((id) => window.__claudeUiFixture.needsYou[id], closed.id)).toEqual([
    { type: 'pr.checks-failed', at, pr: 'acme/app#7' },
    { type: 'pr.approved', at, pr: 'acme/app#7' },
  ]);
});

// A PR type `needsYou` switches off marks nothing; the others found in the same answer still do (decided 2026-11-06).
test('with approved switched off, a PR turning approved with failing checks marks only the failing checks', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, settings: needsYouFile(switchedOff('pr.approved')) });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);

  await gitHubSays(page, { 'acme/app#7': open({ review: 'approved', checks: 'failed' }), 'acme/app#8': open() });
  await nextAsk(page);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 checks failed');
  await expect.poll(() => page.evaluate((id) => window.__claudeUiFixture.needsYou[id], closed.id)).toEqual([{ type: 'pr.checks-failed', at: expect.any(Number), pr: 'acme/app#7' }]);
});

// A whole category switched off: none of its types marks.
test('with Finish up switched off, a PR merging marks nothing', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, settings: needsYouFile(switchedOff('finish-up')) });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await gitHubSays(page, { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() });
  await nextAsk(page);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen?.['acme/app#7'])).toEqual({ state: 'merged', role: 'own' });
  await notNeeds(row(page, closed.title).locator('.nudge'));
  expect(await app.calls('markNeedsYou')).toEqual([]);
});

// The reasons are kept side by side, the PR's ranked first, and the dot on show follows a reason added while it is drawn.
test('a session that needs you already gets the PR reason beside it, listed first, on a dot already on show', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, needsYou: { [cold.id]: [{ type: 'app.was-running', at: 1, how: 'quit' }] } });
  const dot = tab(page, cold.title).locator('.nudge');
  await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — was running when the app quit');

  await gitHubSays(page, { 'acme/app#7': open({ conflict: true }), 'acme/app#8': open() });
  await nextAsk(page);
  await expect(dot).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merge conflict\nNeeds you — was running when the app quit');
});

test('approved marks when the review turns approved, and not when it shows again after a push', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture);
  await gitHubSays(page, { 'acme/app#7': open({ review: 'approved' }), 'acme/app#8': open() });
  await nextAsk(page);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 approved');

  await gitHubSays(page, { 'acme/app#7': open({ review: 'approved', checks: 'running' }), 'acme/app#8': open() });
  await nextAsk(page);
  await gitHubSays(page, { 'acme/app#7': open({ review: 'approved' }), 'acme/app#8': open() });
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(4);
  expect((await app.calls('markNeedsYou')).length).toBe(1);
});

test('a closed PR opened again marks as reopened', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, prSeen: { ...seenOpen, 'acme/app#7': { state: 'closed', role: 'own' } }, prStatuses: { 'acme/app#7': { state: 'closed', role: 'own' }, 'acme/app#8': open() } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await gitHubSays(page, { 'acme/app#7': open(), 'acme/app#8': open() });
  await nextAsk(page);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 reopened');
});

// A PR merged while the app was closed has what was seen before to change from.
test('a PR that changed while the app was closed marks at launch', async ({ app, page }) => {
  await app.boot({ ...fixture, prStatuses: { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() } });
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merged');
});

// Nothing seen before: only the sessions set aside to wait, with a tab or a later mark, are marked, not every ended session never marked finished (decided 2026-10-29).
test('the first run marks the sessions with a tab or a later mark whose PRs need you, and no other; the next answer marks nothing new', async ({ app, page }) => {
  await page.clock.install();
  const setAside = session({ id: '00000000-0000-4000-8000-0000000000f5', title: 'Set aside', prs: [pr(7)] });
  await app.boot({
    ...fixture,
    sessions: [...all, setAside],
    history: { ...fixture.history, [setAside.id]: [] },
    setAside: { [setAside.id]: { due: null, at: 1 } },
    prSeen: null,
    prStatuses: { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() },
  });
  for (const title of [cold.title, setAside.title]) await expect(row(page, title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merged');
  await notNeeds(row(page, closed.title).locator('.nudge'));
  await notNeeds(row(page, other.title).locator('.nudge'));
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen)).toEqual({ 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() });

  await nextAsk(page);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);
  expect((await app.calls('markNeedsYou')).length).toBe(1);
});

// A read of what was seen that fails marks nothing that time, and is tried again at the next ask, which goes on as before.
test('a failed read of what was last seen leaves the asking going, and the next ask reads it and marks', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture, prSeenReadFails: 1, prStatuses: { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await notNeeds(row(page, closed.title).locator('.nudge'));

  await nextAsk(page);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merged');
});

// The read only spares a write; turning it off has to empty what was seen whatever the read did, or turning it on would mark what changed while it was off.
test('turned off when what was seen cannot be read, it is emptied all the same, and turning it on marks nothing from before', async ({ app, page }) => {
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { prStatus: false }), prSeenReadFails: 1 });
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen)).toEqual({});

  await gitHubSays(page, { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() });
  await app.settingsOnDisk(settingsFileWith('settings.json', { prStatus: true }));
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen?.['acme/app#7'])).toEqual({ state: 'merged', role: 'own' });
  await notNeeds(row(page, closed.title).locator('.nudge'));
});

// A PR type fires only for the roles its file lists (design decision 110): a conflict asks the author to act, so the bundled one fires on your own PR alone.
test('a conflict marks the sessions linking your own PR, not those linking a PR you review, until needsYou adds that role', async ({ app, page }) => {
  await page.clock.install();
  const reviewed = (overrides: Partial<Extract<PrStatus, { state: 'open' }>> = {}): PrStatus => open({ role: 'reviewing', ...overrides });
  await app.boot({ ...fixture, prSeen: { 'acme/app#7': open(), 'acme/app#8': reviewed() }, prStatuses: { 'acme/app#7': open(), 'acme/app#8': reviewed() } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);

  await gitHubSays(page, { 'acme/app#7': open({ conflict: true }), 'acme/app#8': reviewed({ conflict: true }) });
  await nextAsk(page);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merge conflict');
  await notNeeds(row(page, other.title).locator('.nudge'));

  await app.settingsOnDisk(needsYouFile({ 'pr.conflict': { roles: ['own', 'reviewing'] } }));
  await gitHubSays(page, { 'acme/app#7': open({ conflict: true }), 'acme/app#8': reviewed() });
  await nextAsk(page);
  await gitHubSays(page, { 'acme/app#7': open({ conflict: true }), 'acme/app#8': reviewed({ conflict: true }) });
  await nextAsk(page);
  await expect(row(page, other.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #8 merge conflict');
});

test('a PR you review marks its sessions for new commits since your review, and for your review asked again, and your own PR marks for neither', async ({ app, page }) => {
  await page.clock.install();
  const reviewed = (overrides: Partial<Extract<PrStatus, { state: 'open' }>> = {}): PrStatus => open({ role: 'reviewing', ...overrides });
  await app.boot({ ...fixture, prSeen: { 'acme/app#7': open(), 'acme/app#8': reviewed() }, prStatuses: { 'acme/app#7': open(), 'acme/app#8': reviewed() } });
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);

  await gitHubSays(page, { 'acme/app#7': open({ newCommits: true, reviewAsked: true }), 'acme/app#8': reviewed({ newCommits: true, reviewAsked: true }) });
  await nextAsk(page);
  await expect(row(page, other.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #8 new commits since your review, your review asked again');
  await notNeeds(row(page, closed.title).locator('.nudge'));
});

// Turning PR status on starts from the PRs as they are then (decided 2026-10-29).
test('turned off and on again, a PR that changed meanwhile marks nothing, and its next change does', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture);
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(1);
  await app.settingsOnDisk(settingsFileWith('settings.json', { prStatus: false }));
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen)).toEqual({});

  await gitHubSays(page, { 'acme/app#7': open({ review: 'changes-requested' }), 'acme/app#8': open() });
  await app.settingsOnDisk(settingsFileWith('settings.json', { prStatus: true }));
  await expect.poll(() => app.calls('prStatuses')).toHaveLength(2);
  await expect.poll(() => page.evaluate(() => window.__claudeUiFixture.prSeen?.['acme/app#7'])).toEqual(open({ review: 'changes-requested' }));
  await notNeeds(row(page, closed.title).locator('.nudge'));

  await gitHubSays(page, { 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': open() });
  await nextAsk(page);
  await expect(row(page, closed.title).locator('.nudge')).toHaveAttribute('data-tooltip', 'Needs you — PR #7 merged');
});
