import type { Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { tabLabel } from '../../../../support/window';

// Each pill narrows the list to what it names, is shown pressed, and a second press gives the whole list back; which session passes which pill is `sessionPasses`'s, unit-tested on its own, so this holds the wiring.
const plain = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'A plain one' });
const worktree = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'In a worktree', worktree: 'feature-x' });
const sibling = session({ id: '00000000-0000-4000-8000-0000000000c3', title: 'A sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000c4'] });
const itsSibling = session({ id: '00000000-0000-4000-8000-0000000000c4', title: 'Its sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000c3'] });
const noted = session({ id: '00000000-0000-4000-8000-0000000000c5', title: 'With a note' });
const gone = session({ id: '00000000-0000-4000-8000-0000000000c6', title: 'Its folder is gone', cwdExists: false });
const tabbed = session({ id: '00000000-0000-4000-8000-0000000000c7', title: 'With a tab' });
const everyone = [plain, worktree, sibling, itsSibling, noted, gone, tabbed];
const fixture = { sessions: everyone, notes: { [noted.id]: 'Remember this' }, openSessions: [tabbed.id], history: { [tabbed.id]: [] } };

/** The list's titles, in no particular order: which rows there are is what a pill decides. */
const titles = async (page: Page): Promise<string[]> => (await page.locator('#sessions .session .card-title').allTextContents()).sort();
const sorted = (...list: { title: string }[]): string[] => list.map((s) => s.title).sort();

/** Press a pill, see the list it leaves, and press it again for the whole list back. */
async function pressAndBack(page: Page, pill: string, shows: string[]): Promise<void> {
  const button = page.locator(`#${pill}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => titles(page)).toEqual(shows);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => titles(page)).toEqual(sorted(...everyone));
}

for (const [pill, name, shows] of [
  ['worktree-filter', 'worktree', sorted(worktree)],
  ['sibling-filter', 'siblings', sorted(sibling, itsSibling)],
  ['note-filter', 'note', sorted(noted)],
  ['gone-filter', 'gone', sorted(gone)],
  ['open-filter', 'open', sorted(tabbed)],
] as const) {
  test(`the ${name} pill narrows the list to its sessions, and a second press undoes it`, async ({ app, page }) => {
    await app.boot(fixture);
    await expect.poll(() => titles(page)).toEqual(sorted(...everyone));
    await page.locator('#filter-toggle').click();
    await pressAndBack(page, pill, shows);
  });
}

test('the live pill narrows the list to the sessions running, and a second press undoes it', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  // Open but not running: live leaves nothing.
  await page.locator('#live-filter').click();
  await expect.poll(() => titles(page)).toEqual([]);
  await page.locator('#live-filter').click();

  await tabLabel(page, tabbed.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await pressAndBack(page, 'live-filter', sorted(tabbed));
});
