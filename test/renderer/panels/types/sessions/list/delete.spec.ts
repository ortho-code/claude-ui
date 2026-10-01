import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// Deleting is the archived view's, confirmed first (docs/architecture.md § App-side metadata and session groups).
// The row goes the moment the delete is confirmed and never comes back: it stays hidden while its files are being moved to the trash, and stops being hidden in the same change as the listing that no longer has it.
const kept = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Kept session' });
const gone = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'Deleted session' });
const archivedView = { uiState: { ...defaultUi(), filters: { ...defaultUi().filters, archived: true } } };
const fixture = { sessions: [kept, gone], archived: { [kept.id]: 1, [gone.id]: 2 }, pinned: [gone.id], notes: { [gone.id]: 'a note' }, ...archivedView };

/** Count every time a row for `key` is put into the page from now on. */
const watchAdded = (page: Page, key: string): Promise<void> =>
  page.evaluate((watched) => {
    const added: Node[] = [];
    (window as unknown as { __added: Node[] }).__added = added;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches(`.session[data-key="${watched}"]`) || node.querySelector(`.session[data-key="${watched}"]`))) added.push(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, key);
const addedCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __added: Node[] }).__added.length);

test('cancelling a delete leaves the session where it was', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('.session', { hasText: gone.title }).locator('.delete-btn').click();
  await expect(page.locator('#confirm-message')).toHaveText(`Delete "${gone.title}"?`);
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#confirm-overlay')).toBeHidden();
  await expect(page.locator('.session', { hasText: gone.title })).toHaveCount(1);
  expect(await app.calls('deleteSession')).toEqual([]);
});

test('a confirmed delete takes the row away at once and it never comes back', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('.session', { hasText: gone.title })).toHaveCount(1);
  const reads = (await app.calls('listSessions')).length;
  await page.locator('.session', { hasText: gone.title }).locator('.delete-btn').click();
  await watchAdded(page, gone.id);
  await page.locator('#confirm-ok').click();

  await expect(page.locator('.session', { hasText: gone.title })).toHaveCount(0);
  await expect.poll(() => app.calls('deleteSession')).toEqual([[gone.id]]);
  // The read after the delete is what stops hiding it; everything after it is answered at once, so by the next look the list has been drawn from it.
  await expect.poll(async () => (await app.calls('listSessions')).length).toBe(reads + 1);
  await expect(page.locator('#sessions .session .card-title')).toHaveText([kept.title]);
  expect(await addedCount(page)).toBe(0);
});
