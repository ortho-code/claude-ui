import type { Locator, Page } from '@playwright/test';
import type { BaseCandidate, DiffBases } from '../../../../../src/shared/diff/types';
import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { bootDiff, file, menuRows, panel, picksData, questionButton, rootRows, summary } from './explorer';

// What Since branched is measured from is picked per checkout, from its kebab, or from the base words over the list while there is one checkout: kept for the branch the checkout has out, or for every checkout of its repository.

const FIX = `${PROJECT}/.claude/worktrees/fix`;
const OLD = `${PROJECT}/.claude/worktrees/old`;
const AT = '2026-11-19T08:00:00.000Z';

/** The branches main offers in either worktree, the worktrees' own included, and a default on each of two remotes. */
const CANDIDATES: BaseCandidate[] = [
  { ref: 'fix', isDefault: false, local: true },
  { ref: 'old', isDefault: false, local: true },
  { ref: 'stacked', isDefault: false, local: true },
  { ref: 'origin/main', isDefault: true, local: false },
  { ref: 'upstream/main', isDefault: true, local: false },
  { ref: 'origin/feature', isDefault: false, local: false },
];
const COUNTS = { fix: 0, old: 3, stacked: 1, 'origin/main': 7, 'upstream/main': 2, 'origin/feature': null };

/** A session in the `fix` worktree that also changed files in `old`, both checkouts of the project's repository, each read since it branched and for Uncommitted. */
function inWorktrees(kept: Record<string, DiffBases> = {}, oldDetached = false): NonNullable<Parameters<typeof bootDiff>[2]> {
  const old = { root: OLD, branch: oldDetached ? null : 'old', files: [file('src/b.ts')] };
  return {
    as: { cwd: FIX, worktree: 'fix', checkouts: [{ root: FIX, at: AT, gone: false, own: true }, { root: OLD, at: AT, gone: false, own: false }] },
    checkouts: {
      [FIX]: { diffs: { since: summary({ root: FIX, branch: 'fix', files: [file('src/a.ts')] }), uncommitted: summary({ root: FIX, branch: 'fix', files: [file('src/a.ts')] }) } },
      [OLD]: { diffs: { since: summary(old), uncommitted: summary(old) } },
    },
    bases: { candidates: { [FIX]: CANDIDATES, [OLD]: CANDIDATES }, counts: { [FIX]: COUNTS, [OLD]: COUNTS }, repoOf: { [FIX]: PROJECT, [OLD]: PROJECT }, kept },
  };
}

const main = { since: summary({ root: PROJECT, branch: 'develop' }) };

const rootRow = (page: Page, name: string): Locator => rootRows(page).filter({ has: page.locator('.card-title', { hasText: new RegExp(`^${name}$`) }) });
const baseMark = (page: Page, name: string): Locator => rootRow(page, name).locator('.explorer-base');
const picker = (page: Page): Locator => page.locator('.base-picker');
const pickerRows = (page: Page): Locator => picker(page).locator('.base-picker-row');
const pickerRow = (page: Page, ref: string): Locator => pickerRows(page).filter({ has: page.locator('.base-picker-ref', { hasText: new RegExp(`^${ref}$`) }) });
const defaultRow = (page: Page): Locator => picker(page).locator('.base-picker-default');
const save = (page: Page): Locator => picker(page).getByRole('button', { name: 'Save' });
/** The box's first line, what this checkout measures from now and why, and its second, what Save will do. */
const inUse = (page: Page): Locator => picker(page).locator('.base-picker-line').nth(0);
const changedTo = (page: Page): Locator => picker(page).locator('.base-picker-line').nth(1);
const selectedRows = (page: Page): Locator => picker(page).locator('.base-picker-row[aria-selected="true"] .base-picker-ref');
const whole = (page: Page): Locator => picker(page).getByRole('checkbox', { name: /Use for the whole project/ });
const list = (page: Page): Locator => picker(page).locator('.base-picker-list');
/** How far the list is scrolled. */
const scrolled = (page: Page): Promise<number> => list(page).evaluate((el) => el.scrollTop);
/** Whether the row of `ref` is in the list's view. */
const inView = (page: Page, ref: string): Promise<boolean> =>
  pickerRow(page, ref).evaluate((row) => {
    const box = row.closest('.base-picker-list')!.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    return at.top >= box.top && at.bottom <= box.bottom;
  });
/** Branches enough that the list scrolls, all on origin. */
const many: BaseCandidate[] = Array.from({ length: 60 }, (_, n) => ({ ref: `origin/old-${String(n).padStart(2, '0')}`, isDefault: false, local: false }));

/** Select `ref` and save it. */
async function choose(page: Page, ref: string): Promise<void> {
  await pickerRow(page, ref).click();
  await save(page).click();
  await expect(picker(page)).toBeHidden();
}
/** What main keeps, by repository. */
const kept = (page: Page): Promise<Record<string, DiffBases>> => page.evaluate(() => window.__claudeUiFixture.bases.kept);

async function openFor(page: Page, name: string): Promise<void> {
  await rootRow(page, name).locator('.explorer-root-kebab').click();
  await menuRows(page).filter({ hasText: 'Change the base…' }).click();
  await expect(picker(page)).toBeVisible();
}

test('a checkout’s menu offers to change its base, under the line naming it', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await rootRow(page, 'old').locator('.explorer-root-kebab').click();
  await expect(menuRows(page).first()).toHaveText('Change the base…');
});

test('next to a checkout’s long name the base mark keeps room to read its base, and the name gives way', async ({ app, page }) => {
  const name = 'sync-composer-locks-also-updates-what-a-changed-library-needs';
  const root = `${PROJECT}/.claude/worktrees/${name}`;
  await bootDiff(app, {}, {
    as: { cwd: root, worktree: name, checkouts: [{ root, at: AT, gone: false, own: true }] },
    checkouts: { [root]: { diffs: { since: summary({ root, branch: name, files: [file('a.ts')] }) } } },
    bases: { kept: { [root]: { project: null, branches: { [name]: 'hourly-security-job-gets-a-github-token' } } } },
  });
  const mark = rootRows(page).first().locator('.explorer-base');
  await expect(mark).toHaveText('from hourly-security-job-gets-a-github-token');
  expect(await mark.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(100);
  expect(await rootRows(page).first().locator('.card-title').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('a short base keeps only its own width, whole, next to a long name', async ({ app, page }) => {
  const name = 'sync-composer-locks-also-updates-what-a-changed-library-needs';
  const root = `${PROJECT}/.claude/worktrees/${name}`;
  await bootDiff(app, {}, {
    as: { cwd: root, worktree: name, checkouts: [{ root, at: AT, gone: false, own: true }] },
    checkouts: { [root]: { diffs: { since: summary({ root, branch: name, files: [file('a.ts')] }) } } },
    bases: { kept: { [root]: { project: null, branches: { [name]: 'main' } } } },
  });
  const mark = rootRows(page).first().locator('.explorer-base');
  await expect(mark).toHaveText('from main');
  expect(await mark.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width < 80)).toBe(true);
});

test('a checkout answering another question offers no base to change, since none would change what it lists', async ({ app, page }) => {
  await bootDiff(app, main, { ...inWorktrees(), data: picksData({ roots: { [OLD]: 'uncommitted' } }) });
  await rootRow(page, 'old').locator('.explorer-root-kebab').click();
  await expect(menuRows(page).first()).toHaveText('Follow the panel · Since branched');
  await expect(menuRows(page).filter({ hasText: 'Change the base…' })).toHaveCount(0);
});

test('the picker lists Default, then the default branches, then the local ones, then the other remote ones, each by name, the checkout’s own branch left out', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await expect(picker(page).locator('.base-picker-group, .base-picker-ref')).toHaveText(['Default', 'Default', 'Default branches', 'origin/main', 'upstream/main', 'Local branches', 'fix', 'stacked', 'Remote branches', 'origin/feature']);
});

test('each row says the commits its branch would count, none shared, or that git could not count them', async ({ app, page }) => {
  const sections = inWorktrees();
  sections.bases!.counts![OLD] = Object.fromEntries(Object.entries(COUNTS).filter(([ref]) => ref !== 'stacked'));
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await expect(pickerRow(page, 'origin/main').locator('.base-picker-count')).toHaveText('7 commits');
  await expect(pickerRow(page, 'origin/feature').locator('.base-picker-count')).toHaveText('no shared history');
  await expect(pickerRow(page, 'stacked').locator('.base-picker-count')).toHaveText('could not count');
});

test('the search narrows the list to the branches whose name holds it', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await picker(page).getByRole('searchbox').fill('main');
  await expect(picker(page).locator('.base-picker-ref')).toHaveText(['origin/main', 'upstream/main']);
  await picker(page).getByRole('searchbox').fill('nothing like it');
  await expect(picker(page).locator('.base-picker-none')).toHaveText('No branch matches.');
});

test('counts are asked only for the rows that have come into view', async ({ app, page }) => {
  const many: BaseCandidate[] = Array.from({ length: 300 }, (_, n) => ({ ref: `origin/old-${String(n).padStart(3, '0')}`, isDefault: false, local: false }));
  const sections = inWorktrees();
  sections.bases!.candidates![OLD] = many;
  sections.bases!.counts![OLD] = Object.fromEntries(many.map((each) => [each.ref, 5]));
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await expect(pickerRow(page, 'origin/old-000').locator('.base-picker-count')).toHaveText('5 commits');
  const asked = async (): Promise<number> => (await app.calls('diffBaseCount')).filter((args) => args[0] === OLD).length;
  const first = await asked();
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(100);
  await pickerRow(page, 'origin/old-299').scrollIntoViewIfNeeded();
  await expect(pickerRow(page, 'origin/old-299').locator('.base-picker-count')).toHaveText('5 commits');
  expect(await asked()).toBeLessThan(200);
});

test('a press only selects; Save keeps the selection for the branch the checkout has out, measures that checkout from it, and its row says so', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await expect(save(page)).toBeDisabled();
  await pickerRow(page, 'stacked').click();
  await expect(picker(page)).toBeVisible();
  await expect(pickerRow(page, 'stacked')).toHaveAttribute('aria-selected', 'true');
  await expect(changedTo(page)).toHaveText('stackedThis branch measures from it.');
  expect(await app.calls('setDiffBase')).toEqual([]);
  await save(page).click();
  await expect(picker(page)).toBeHidden();
  expect(await kept(page)).toEqual({ [PROJECT]: { project: null, branches: { old: 'stacked' } } });
  await expect(baseMark(page, 'old')).toHaveText('from stacked');
  await expect(baseMark(page, 'fix')).toHaveCount(0);
  await rootRow(page, 'old').locator('.explorer-root-kebab').click();
  await expect(page.locator('.kebab-menu .menu-header')).toContainText('from stacked');
});

test('a double click selects and saves at once, here for the checkout the session works in', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'fix');
  await pickerRow(page, 'stacked').dblclick();
  await expect(picker(page)).toBeHidden();
  await expect(baseMark(page, 'fix')).toHaveText('from stacked');
});

test('Use for the whole project opens unticked; ticked, Save keeps the selection for the project and drops this branch’s own pick, so this checkout follows it too', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ [PROJECT]: { project: null, branches: { old: 'stacked', fix: 'stacked' } } }));
  await expect(baseMark(page, 'old')).toHaveText('from stacked');
  await openFor(page, 'old');
  await expect(whole(page)).not.toBeChecked();
  await pickerRow(page, 'origin/main').click();
  await whole(page).check();
  await expect(changedTo(page)).toHaveText("origin/mainEvery checkout of this repository without its own pick measures from it; this branch's own pick, stacked, is dropped.");
  await save(page).click();
  await expect(picker(page)).toBeHidden();
  expect(await kept(page)).toEqual({ [PROJECT]: { project: 'origin/main', branches: { fix: 'stacked' } } });
  await expect(baseMark(page, 'old')).toHaveCount(0);
  await expect(baseMark(page, 'fix')).toHaveText('from stacked');
});

test('with the box ticked, Default drops the project’s base and this branch’s pick, so every checkout without its own pick follows the guess', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ [PROJECT]: { project: 'origin/main', branches: { old: 'stacked' } } }));
  await openFor(page, 'old');
  await defaultRow(page).click();
  await whole(page).check();
  await expect(defaultRow(page).locator('.base-picker-count')).toHaveText('the guess · upstream/main');
  await expect(changedTo(page)).toHaveText("upstream/mainEvery checkout of this repository without its own pick follows the guess, upstream/main; this branch's own pick, stacked, is dropped.");
  await save(page).click();
  await expect(picker(page)).toBeHidden();
  expect(await kept(page)).toEqual({});
});

test('a branch picked by hand that names the guess reads as a pick: selected on opening, and the row marked', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await choose(page, 'upstream/main');
  expect(await kept(page)).toEqual({ [PROJECT]: { project: null, branches: { old: 'upstream/main' } } });
  await expect(baseMark(page, 'old')).toHaveText('from upstream/main');
  await openFor(page, 'old');
  await expect(selectedRows(page)).toHaveText(['upstream/main']);
  await expect(inUse(page)).toContainText('Kept for this branch.');
});

test('In use says what this checkout measures from and why; Default names the project’s base while the project keeps one, and saving it drops the branch’s pick', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ [PROJECT]: { project: 'origin/main', branches: { old: 'stacked' } } }));
  await expect(baseMark(page, 'old')).toHaveText('from stacked');
  await openFor(page, 'old');
  await expect(inUse(page)).toHaveText('stackedKept for this branch.');
  await expect(changedTo(page)).toHaveText('No change');
  await expect(defaultRow(page).locator('.base-picker-ref')).toHaveText('Default');
  await expect(defaultRow(page).locator('.base-picker-count')).toHaveText("the project's · origin/main");
  await defaultRow(page).click();
  await expect(changedTo(page)).toHaveText("origin/mainThis branch's own pick is dropped; it follows the project's base, origin/main.");
  await save(page).click();
  await expect(picker(page)).toBeHidden();
  expect(await kept(page)).toEqual({ [PROJECT]: { project: 'origin/main', branches: {} } });
  await expect(baseMark(page, 'old')).toHaveCount(0);
});

test('Undo puts the selection and the box back as they were on opening', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ [PROJECT]: { project: null, branches: { old: 'stacked' } } }));
  await openFor(page, 'old');
  await pickerRow(page, 'origin/main').click();
  await whole(page).check();
  await picker(page).getByRole('button', { name: 'Undo' }).click();
  await expect(selectedRows(page)).toHaveText(['stacked']);
  await expect(whole(page)).not.toBeChecked();
  await expect(changedTo(page)).toHaveText('No change');
  await expect(save(page)).toBeDisabled();
});

test('a project base that is gone is not what Default stands for, and In use says so', async ({ app, page }) => {
  const sections = inWorktrees({ [PROJECT]: { project: 'origin/gone', branches: {} } });
  sections.bases!.gone = ['origin/gone'];
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await expect(inUse(page)).toContainText('origin/gone is gone');
  await expect(defaultRow(page).locator('.base-picker-count')).toHaveText('the guess · upstream/main');
  await whole(page).check();
  await expect(changedTo(page)).toHaveText('upstream/mainEvery checkout of this repository without its own pick follows the guess, upstream/main.');
  await save(page).click();
  await expect(picker(page)).toBeHidden();
  expect(await kept(page)).toEqual({});
});

test('dropping this branch’s pick while the project’s base is gone names the guess as what it then follows', async ({ app, page }) => {
  const sections = inWorktrees({ [PROJECT]: { project: 'origin/gone', branches: { old: 'stacked' } } });
  sections.bases!.gone = ['origin/gone'];
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await defaultRow(page).click();
  await expect(changedTo(page)).toHaveText("upstream/mainThis branch's own pick is dropped; it follows the guess, upstream/main.");
});

test('nothing kept, Default is selected and the list opens at its top, Save is unavailable, and Cancel keeps nothing', async ({ app, page }) => {
  const sections = inWorktrees();
  sections.bases!.candidates![OLD] = [...CANDIDATES, ...many];
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await expect(selectedRows(page)).toHaveText(['Default']);
  expect(await scrolled(page)).toBe(0);
  await expect(save(page)).toBeDisabled();
  await pickerRow(page, 'stacked').click();
  await expect(save(page)).toBeEnabled();
  await picker(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(picker(page)).toBeHidden();
  expect(await app.calls('setDiffBase')).toEqual([]);
});

test('a save that Esc closes the dialog on is still read once main has kept it', async ({ app, page }) => {
  const sections = inWorktrees();
  sections.bases!.holding = true;
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await pickerRow(page, 'stacked').click();
  await save(page).click();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await page.evaluate(() => (window.__claudeUiFixture.bases.holding = false));
  await expect(baseMark(page, 'old')).toHaveText('from stacked');
});

test('the list keeps its height whatever the box says, one line or two', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ [PROJECT]: { project: null, branches: { old: 'stacked' } } }));
  await openFor(page, 'old');
  await expect(changedTo(page)).toHaveText('No change');
  const height = (): Promise<number> => list(page).evaluate((el) => el.getBoundingClientRect().height);
  const before = await height();
  await pickerRow(page, 'origin/main').click();
  await whole(page).check();
  await expect(changedTo(page)).toContainText('is dropped');
  expect(await height()).toBe(before);
});

test('Default reads whole whatever the box, what it stands for cut where it must and whole in its tooltip', async ({ app, page }) => {
  const base = 'a-project-base-with-a-name-long-enough-to-take-more-room-than-the-row-has';
  await bootDiff(app, main, inWorktrees({ [PROJECT]: { project: base, branches: {} } }));
  await openFor(page, 'old');
  const name = defaultRow(page).locator('.base-picker-ref');
  const fits = (el: HTMLElement): boolean => el.scrollWidth <= el.clientWidth;
  for (const box of [false, true]) {
    await whole(page).setChecked(box);
    expect(await name.evaluate(fits)).toBe(true);
  }
  await whole(page).uncheck();
  await expect(defaultRow(page)).toHaveAttribute('title', `Default: no base of its own here, so it follows the project's base, ${base}.`);
});

test('the list opens on this branch’s own pick, scrolled to it, and a press on a name in the box goes to that branch’s row', async ({ app, page }) => {
  const sections = inWorktrees({ [PROJECT]: { project: 'origin/old-05', branches: { old: 'origin/old-55' } } });
  sections.bases!.candidates![OLD] = [...CANDIDATES, ...many];
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await expect(selectedRows(page)).toHaveText(['origin/old-55']);
  expect(await inView(page, 'origin/old-55')).toBe(true);
  await defaultRow(page).click();
  await expect(changedTo(page).locator('.base-picker-goto')).toHaveText('origin/old-05');
  await changedTo(page).locator('.base-picker-goto').click();
  await expect.poll(() => inView(page, 'origin/old-05')).toBe(true);
  await inUse(page).locator('.base-picker-goto').click();
  await expect.poll(() => inView(page, 'origin/old-55')).toBe(true);
});

test('a group’s heading stays at the top of the list while its rows scroll under it', async ({ app, page }) => {
  const sections = inWorktrees();
  sections.bases!.candidates![OLD] = [...CANDIDATES, ...many];
  await bootDiff(app, main, sections);
  await openFor(page, 'old');
  await list(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
  const top = (locator: Locator): Promise<number> => locator.evaluate((el) => el.getBoundingClientRect().top);
  const heading = picker(page).locator('.base-picker-group', { hasText: 'Remote branches' });
  expect(Math.abs((await top(heading)) - (await top(list(page))))).toBeLessThanOrEqual(2);
});

test('a branch’s tooltip names the branch whole and what it would count', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await expect(pickerRow(page, 'origin/main')).toHaveAttribute('title', "origin/main: would count 7 commits as this branch's own.");
  await expect(pickerRow(page, 'origin/feature')).toHaveAttribute('title', "origin/feature: shares no history with this branch.");
});

test('a double click outside the rows, on a group’s heading, saves nothing', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await pickerRow(page, 'stacked').click();
  await picker(page).locator('.base-picker-group', { hasText: 'Local branches' }).dblclick();
  await expect(picker(page)).toBeVisible();
  expect(await app.calls('setDiffBase')).toEqual([]);
});

test('Enter in the search saves what is selected; Enter on Cancel only cancels', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await openFor(page, 'old');
  await pickerRow(page, 'stacked').click();
  await picker(page).getByRole('button', { name: 'Cancel' }).press('Enter');
  await expect(picker(page)).toBeHidden();
  expect(await app.calls('setDiffBase')).toEqual([]);
  await openFor(page, 'old');
  await pickerRow(page, 'stacked').click();
  await picker(page).getByRole('searchbox').press('Enter');
  await expect(picker(page)).toBeHidden();
  expect(await kept(page)).toEqual({ [PROJECT]: { project: null, branches: { old: 'stacked' } } });
});

test('a detached checkout keeps its pick for the project, its whole-project choice ticked and fixed', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({}, true));
  await openFor(page, 'old');
  await expect(whole(page)).toBeChecked();
  await expect(whole(page)).toBeDisabled();
  await choose(page, 'origin/main');
  expect(await kept(page)).toEqual({ [PROJECT]: { project: 'origin/main', branches: {} } });
});

test('a checkout set to another question on its own does not mark the base its branch keeps', async ({ app, page }) => {
  await bootDiff(app, main, { ...inWorktrees({ [PROJECT]: { project: null, branches: { old: 'stacked' } } }), data: picksData({ roots: { [OLD]: 'uncommitted' } }) });
  await expect(rootRow(page, 'old').locator('.explorer-question')).toHaveText('Uncommitted');
  await expect(baseMark(page, 'old')).toHaveCount(0);
});

test('with one checkout, the base words over the list open the picker for it, and are only words for another question', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('a.ts')] }), uncommitted: summary({ files: [file('a.ts')] }) }, { bases: { candidates: { [PROJECT]: CANDIDATES }, counts: { [PROJECT]: COUNTS } } });
  const words = panel(page).getByRole('button', { name: /from upstream\/main/ });
  await words.click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await questionButton(page).click();
  await menuRows(page).filter({ hasText: 'Uncommitted' }).click();
  await expect(panel(page).locator('.diff-base:visible')).toHaveText('on top of the last commit');
  await expect(panel(page).getByRole('button', { name: 'on top of the last commit' })).toHaveCount(0);
});
