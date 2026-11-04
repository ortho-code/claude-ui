import type { Locator, Page } from '@playwright/test';
import type { SessionPr } from '../../../../../../src/shared/types';
import { HOME, PROJECT, session, settingsFileWith } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// The review (docs/architecture.md § The review): the Review button opens the list in bulk mode on two sets, Ready to finish (every linked PR merged or closed) and Untouched 30+ days, of the sessions without a tab, not finished, not set aside and not kept, each row saying why it is there.
const DAY = 86_400_000;
// Wednesday 4 November 2026, noon, in the window's own time zone.
const NOW = new Date(2026, 10, 4, 12, 0);
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();
const pr = (number: number): SessionPr => ({ repository: 'acme/app', number, url: `https://github.com/acme/app/pull/${number}` });

const ready = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Merged work', lastActivity: ago(3), prs: [pr(1)] });
const old = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Old idea', lastActivity: ago(41) });
const fresh = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'Fresh work', lastActivity: ago(2) });
const open = session({ id: '00000000-0000-4000-8000-0000000000e4', title: 'Open PR', lastActivity: ago(5), prs: [pr(2)] });
const OTHER = `${HOME}/projects/other`;
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000e5', title: 'Elsewhere old', cwd: OTHER, repoRoot: OTHER, lastActivity: ago(60) });
const all = [ready, old, fresh, open, elsewhere];
const fixture = {
  sessions: all,
  projectOrder: [PROJECT, OTHER],
  prSeen: { 'acme/app#1': { state: 'merged' as const }, 'acme/app#2': { state: 'open' as const, draft: false, review: null, checks: null, conflict: false } },
  prStatuses: { 'acme/app#1': { state: 'merged' as const }, 'acme/app#2': { state: 'open' as const, draft: false, review: null, checks: null, conflict: false } },
  history: Object.fromEntries(all.map((s) => [s.id, []])),
};

const button = (page: Page): Locator => page.locator('#review-button');
const setNames = (page: Page): Locator => page.locator('#sessions .review-set > .section-heading .label');
const setRows = (page: Page, name: string): Locator => page.locator('#sessions .review-set', { has: page.locator('.section-heading .label', { hasText: name }) }).locator('.session .card-title');
const why = (page: Page, title: string): Locator => row(page, title).locator('.meta-text');
const act = (page: Page, name: string): Locator => page.locator(`#bulk-bar [data-act="${name}"]`);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("the button counts the review in the project on show, and every project's in All", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(button(page).locator('.review-count')).toHaveText('2');
  await app.boot({ ...fixture, activeProject: null });
  await expect(button(page).locator('.review-count')).toHaveText('3');
});

test('opening it shows the two sets, each row saying why it is there, and sets the filter aside until Done', async ({ app, page }) => {
  await app.boot({ ...fixture, notes: { [old.id]: 'blocked on design' } });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Fresh');
  await button(page).click();
  await expect(setNames(page)).toHaveText(['Ready to finish', 'Untouched 30+ days']);
  await expect(setRows(page, 'Ready to finish')).toHaveText([ready.title]);
  await expect(setRows(page, 'Untouched 30+ days')).toHaveText([old.title]);
  await expect(why(page, ready.title)).toHaveText('Its PR merged · 3 d ago');
  await expect(why(page, old.title)).toHaveText('41 days · note: “blocked on design”');
  await expect(page.locator('#filter-toggle')).toBeHidden();
  await expect(page.locator('#bulk-line')).toContainText('Review');
  await expect(page.locator('#bulk-line .bulk-count')).toHaveText('demo · 2 to decide · 0 ticked');

  await page.locator('#bulk-done').click();
  await expect(page.locator('#sessions .review-set')).toHaveCount(0);
  await expect(page.locator('#filter-toggle')).toBeVisible();
  await expect(page.locator('#search')).toHaveValue('Fresh');
  await expect(row(page, fresh.title)).toHaveCount(1);
  await expect(row(page, old.title)).toHaveCount(0);
});

test('in All a row says which project and group it sits in, ahead of why', async ({ app, page }) => {
  await app.boot({ ...fixture, activeProject: null, groupState: { groups: [{ id: 'g-ideas', name: 'Ideas', repoRoot: PROJECT }], groupOf: { [old.id]: 'g-ideas' } } });
  await button(page).click();
  await expect(why(page, old.title)).toHaveText('demo › Ideas · 41 days');
  await expect(why(page, elsewhere.title)).toHaveText('other · 60 days');
});

test('Keep takes the ticked rows out of the review until 30 days have passed, and Undo brings them back', async ({ app, page }) => {
  await app.boot(fixture);
  await button(page).click();
  await row(page, old.title).click();
  await act(page, 'keep').click();
  await expect(page.locator('#toast-message')).toHaveText(`Kept "${old.title}" out of the review for 30 days`);
  await expect(row(page, old.title)).toHaveCount(0);
  const [[ids, at]] = (await app.calls('keep')) as [string[], number][];
  expect(ids).toEqual([old.id]);
  await page.locator('#toast-action').click();
  await expect(row(page, old.title)).toHaveCount(1);
  expect(await app.calls('unkeep')).toEqual([[[old.id]]]);
  expect(at).toBe(NOW.getTime());
});

test('a stamp past its 30 days holds nothing out, and one within them does', async ({ app, page }) => {
  await app.boot({ ...fixture, kept: { [old.id]: NOW.getTime() - 29 * DAY } });
  await expect(button(page).locator('.review-count')).toHaveText('1');
  await app.boot({ ...fixture, kept: { [old.id]: NOW.getTime() - 31 * DAY } });
  await expect(button(page).locator('.review-count')).toHaveText('2');
});

test('Later and Archive take a row out too, and the review ends once nothing is left in it', async ({ app, page }) => {
  await app.boot(fixture);
  await button(page).click();
  await row(page, old.title).click();
  await act(page, 'later').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Whenever$/ }).click();
  await expect(row(page, old.title)).toHaveCount(0);
  await row(page, ready.title).click();
  await act(page, 'archive').click();
  // The act's own toast, with its Undo, is what is said.
  await expect(page.locator('#toast-message')).toHaveText(`Archived "${ready.title}"`);
  await expect(page.locator('#bulk-line')).toBeHidden();
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Nothing to review');
});

test('with PR status off, Ready to finish holds nothing and its line says why', async ({ app, page }) => {
  await app.boot({ ...fixture, settings: settingsFileWith('settings.json', { prStatus: false }) });
  await button(page).click();
  await expect(setRows(page, 'Ready to finish')).toHaveCount(0);
  await expect(page.locator('.review-set .review-note').first()).toHaveText("PR status is off in Settings, so which sessions' PRs are settled is not known.");
  await expect(setRows(page, 'Untouched 30+ days')).toHaveText([old.title]);
});

test('a row whose session gets a tab while reviewing leaves the review, and the last one leaving ends it', async ({ app, page }) => {
  await app.boot(fixture);
  await button(page).click();
  await row(page, old.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Open$/ }).click();
  await expect(row(page, old.title)).toHaveCount(0);
  await expect(page.locator('#bulk-line .bulk-count')).toHaveText('demo · 1 to decide · 0 ticked');
  await row(page, ready.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Open$/ }).click();
  await expect(page.locator('#bulk-line')).toBeHidden();
});

test("a set's heading stays in sight at the top of the list while its rows scroll under it, as a project's does", async ({ app, page }) => {
  const many = Array.from({ length: 40 }, (_, i) => session({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, title: `Old ${i}`, lastActivity: ago(40 + i) }));
  await app.boot({ ...fixture, sessions: [...all, ...many], history: Object.fromEntries([...all, ...many].map((s) => [s.id, []])) });
  await button(page).click();
  const list = page.locator('#sessions');
  const heading = page.locator('#sessions .review-set', { has: page.locator('.label', { hasText: 'Untouched' }) }).locator('> .section-heading');
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
  const [listTop, headingTop] = await Promise.all([list.evaluate((el) => el.getBoundingClientRect().top), heading.evaluate((el) => el.getBoundingClientRect().top)]);
  expect(Math.round(headingTop)).toBe(Math.round(listTop));
});

test('a session with a tab is left to its tab, and the button is unavailable when nothing is to decide', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [ready, fresh], openSessions: [ready.id] });
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Nothing to review');
  await button(page).click({ force: true });
  await expect(page.locator('#bulk-line')).toBeHidden();
});
