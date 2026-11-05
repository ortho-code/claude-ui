import type { Page } from '@playwright/test';
import { session, sorted } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { sortedTitles, tabLabel } from '../../../../support/window';

// Each pill narrows the list to what it names, is shown pressed, and a second press gives the whole list back; which session passes which pill is `sessionPasses`'s, unit-tested on its own, so this holds the wiring.
const plain = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'A plain one' });
const worktree = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'In a worktree', worktree: 'feature-x' });
const sibling = session({ id: '00000000-0000-4000-8000-0000000000c3', title: 'A sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000c4'] });
const itsSibling = session({ id: '00000000-0000-4000-8000-0000000000c4', title: 'Its sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000c3'] });
const noted = session({ id: '00000000-0000-4000-8000-0000000000c5', title: 'With a note' });
const gone = session({ id: '00000000-0000-4000-8000-0000000000c6', title: 'Its folder is gone', cwdExists: false });
const tabbed = session({ id: '00000000-0000-4000-8000-0000000000c7', title: 'With a tab' });
const leftWorktree = session({ id: '00000000-0000-4000-8000-0000000000c8', title: 'Left a worktree', leftWorktree: 'feature-y' });
const withPr = session({ id: '00000000-0000-4000-8000-0000000000c9', title: 'Linked a PR', prs: [{ repository: 'ScientaNL/demo', number: 1, url: 'https://github.com/ScientaNL/demo/pull/1' }] });
const everyone = [plain, worktree, sibling, itsSibling, noted, gone, tabbed, leftWorktree, withPr];
const fixture = { sessions: everyone, notes: { [noted.id]: 'Remember this' }, openSessions: [tabbed.id], history: { [tabbed.id]: [] } };

/** Press a pill, see the list it leaves, and press it again for the whole list back. */
async function pressAndBack(page: Page, pill: string, shows: string[]): Promise<void> {
  const button = page.locator(`#${pill}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sortedTitles(page)).toEqual(shows);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(...everyone));
}

for (const [pill, name, shows] of [
  ['worktree-filter', 'worktree', sorted(worktree, leftWorktree)],
  ['sibling-filter', 'siblings', sorted(sibling, itsSibling)],
  ['pr-filter', 'PR', sorted(withPr)],
  ['note-filter', 'note', sorted(noted)],
  ['gone-filter', 'gone', sorted(gone)],
  ['open-filter', 'open', sorted(tabbed)],
] as const) {
  test(`the ${name} pill narrows the list to its sessions, and a second press undoes it`, async ({ app, page }) => {
    await app.boot(fixture);
    await expect.poll(() => sortedTitles(page)).toEqual(sorted(...everyone));
    await page.locator('#filter-toggle').click();
    await pressAndBack(page, pill, shows);
  });
}

// Later is a mark on the session, kept with a tab or without (decided 2026-10-29), so the pill finds both.
test('the later pill narrows the list to the sessions marked for later, with a tab or without, and a second press undoes it', async ({ app, page }) => {
  const aside = session({ id: '00000000-0000-4000-8000-0000000000ca', title: 'Set aside' });
  const all = [...everyone, aside];
  await app.boot({ ...fixture, sessions: all, openSessions: [tabbed.id, aside.id], later: { [aside.id]: { due: null, at: 1 }, [plain.id]: { due: Date.now() + 86_400_000, at: 1 } }, history: { [tabbed.id]: [], [aside.id]: [] } });
  await page.locator('#filter-toggle').click();
  const button = page.locator('#set-aside-filter');
  await expect(button).toHaveAttribute('aria-label', 'Show only sessions marked for later');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // An open tab that is not marked is left out.
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(aside, plain));
  await button.click();
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(...all));
});

test('the live pill narrows the list to the sessions running, and a second press undoes it', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  // Open but not running: live leaves nothing.
  await page.locator('#live-filter').click();
  await expect.poll(() => sortedTitles(page)).toEqual([]);
  await page.locator('#live-filter').click();

  await tabLabel(page, tabbed.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await pressAndBack(page, 'live-filter', sorted(tabbed));
});
