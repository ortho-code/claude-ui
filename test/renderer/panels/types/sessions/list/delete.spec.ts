import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab, titles } from '../../../../support/window';

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

/** Delete `gone` with the listing held, so the read after it has asked main for everything else and waits; answers once it has. */
const deleteWithListingHeld = async (app: App, page: Page): Promise<void> => {
  const asked = (await app.calls('getAllStatuses')).length;
  await app.hold('listSessions');
  await row(page, gone.title).locator('.delete-btn').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(async () => (await app.calls('getAllStatuses')).length).toBe(asked + 1);
};

/** Hand the held listing over, and wait until the read after the delete has been written: the order is seeded from the listing, and written in the same change. */
const releaseListing = async (app: App): Promise<void> => {
  const seeded = (await app.calls('seedProjectOrder')).length;
  await app.release('listSessions');
  await expect.poll(async () => (await app.calls('seedProjectOrder')).length).toBe(seeded + 1);
};

test('cancelling a delete leaves the session where it was', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, gone.title).locator('.delete-btn').click();
  await expect(page.locator('#confirm-message')).toHaveText(`Delete "${gone.title}"?`);
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#confirm-overlay')).toBeHidden();
  await expect(row(page, gone.title)).toHaveCount(1);
  expect(await app.calls('deleteSession')).toEqual([]);
});

test('a confirmed delete takes the row away at once and it never comes back', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(row(page, gone.title)).toHaveCount(1);
  const reads = (await app.calls('listSessions')).length;
  await row(page, gone.title).locator('.delete-btn').click();
  await watchAdded(page, gone.id);
  await page.locator('#confirm-ok').click();

  await expect(row(page, gone.title)).toHaveCount(0);
  await expect.poll(() => app.calls('deleteSession')).toEqual([[gone.id]]);
  // The read after the delete is what stops hiding it; everything after it is answered at once, so by the next look the list has been drawn from it.
  await expect.poll(async () => (await app.calls('listSessions')).length).toBe(reads + 1);
  await expect(titles(page)).toHaveText([kept.title]);
  expect(await addedCount(page)).toBe(0);
});

// The read after a delete asks main for everything at once and writes it when the listing, the slowest, comes back: anything that changed in between is newer than what it read.
const worker = session({ id: '00000000-0000-4000-8000-0000000000c3', title: 'Working session' });

test('a status that lands while the read after a delete is out is not put back by it, so nothing is toasted', async ({ app, page }) => {
  // Its tab restored and not on show, idle as main last said.
  await app.boot({ ...fixture, sessions: [kept, gone, worker], openSessions: [worker.id], statuses: { [worker.id]: 'idle' } });
  const dot = tab(page, worker.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bidle\b/);
  await deleteWithListingHeld(app, page);

  // Busy since main answered the read, which still says idle.
  expect(await app.emit('onSessionStatus', worker.id, 'busy', '', 'UserPromptSubmit')).toBe(1);
  await expect(dot).toHaveClass(/\bbusy\b/);
  await releaseListing(app);
  await expect(row(page, gone.title)).toHaveCount(0);
  await expect(page.locator('#notifications .notif')).toHaveCount(0);
  await expect(dot).toHaveClass(/\bbusy\b/);
});

test('a pin made while the read after a delete is out is not taken back by it', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [kept, gone, worker] });
  await deleteWithListingHeld(app, page);

  // Out of the archived view, where a row has its pin.
  await page.locator('#filter-toggle').click();
  await page.locator('#archived-filter').click();
  const pin = row(page, worker.title).locator('.pin');
  await pin.click();
  await expect(pin).toHaveAttribute('data-tooltip', 'Unpin');
  await releaseListing(app);
  await expect(pin).toHaveAttribute('data-tooltip', 'Unpin');
});
