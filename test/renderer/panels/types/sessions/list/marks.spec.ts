import type { Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row, tabLabel, titles } from '../../../../support/window';

// A session's marks are main's to keep (docs/architecture.md § App-side metadata and session groups): a pin floats its row in its own section, a note rides the row's meta, and archiving puts the session away, closing its tab, until the archived view gives it back.
const newer = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'Newer session' });
const older = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Older session' });
const fixture = { sessions: [newer, older], history: { [newer.id]: [], [older.id]: [] } };

const menuItem = async (page: Page, title: string, label: string): Promise<void> => {
  await row(page, title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: label }).click();
};
const writeNote = async (page: Page, text: string): Promise<void> => {
  await expect(page.locator('#rename-overlay')).toBeVisible();
  await page.locator('#rename-textarea').fill(text);
  await page.locator('#rename-ok').click();
  await expect(page.locator('#rename-overlay')).toBeHidden();
};

test('a pin floats its row to the top of its section and says it can be undone, and unpinning puts it back', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(titles(page)).toHaveText([newer.title, older.title]);

  const pin = row(page, older.title).locator('.pin');
  await expect(pin).toHaveAttribute('data-tooltip', 'Pin');
  await pin.click();
  await expect(titles(page)).toHaveText([older.title, newer.title]);
  await expect(pin).toHaveAttribute('data-tooltip', 'Unpin');
  await expect(pin).toBeEnabled();

  await pin.click();
  await expect(titles(page)).toHaveText([newer.title, older.title]);
  await expect(pin).toHaveAttribute('data-tooltip', 'Pin');
  expect(await app.calls('togglePin')).toEqual([[older.id], [older.id]]);
});

test('a note shows on its row, trimmed, opens from its mark, and a blank one removes it', async ({ app, page }) => {
  await app.boot(fixture);
  const mark = row(page, older.title).locator('.note-badge');
  await expect(mark).toBeHidden();

  await menuItem(page, older.title, 'Add note…');
  await writeNote(page, '  waiting on review  ');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('data-tooltip', 'waiting on review');
  await expect(row(page, newer.title).locator('.note-badge')).toBeHidden();

  // The mark is the way back into it, with the note to edit.
  await mark.click();
  await expect(page.locator('#rename-textarea')).toHaveValue('waiting on review');
  await writeNote(page, '   ');
  await expect(mark).toBeHidden();

  await row(page, older.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button', { hasText: 'Add note…' })).toBeVisible();
  expect(await app.calls('setNote')).toEqual([[older.id, '  waiting on review  '], [older.id, '   ']]);
});

test('archiving closes the session\'s tab and moves its row to the archived view, and unarchiving gives it back without the tab', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [older.id] });
  await expect(tabLabel(page, older.title)).toBeVisible();

  await menuItem(page, older.title, 'Archive');
  await expect(row(page, older.title)).toHaveCount(0);
  await expect(tabLabel(page, older.title)).toHaveCount(0);
  await expect(titles(page)).toHaveText([newer.title]);

  // The archived view manages it rather than resuming it: an unarchive and a delete on the row, no pin, no menu.
  await page.locator('#filter-toggle').click();
  await page.locator('#archived-filter').click();
  await expect(titles(page)).toHaveText([older.title]);
  await expect(row(page, older.title).locator('.card-meta')).toContainText('archived');
  await expect(row(page, older.title).locator('.unarchive-btn')).toBeVisible();
  await expect(row(page, older.title).locator('.pin')).toBeHidden();
  await expect(row(page, older.title).locator('.session-kebab')).toBeHidden();

  await row(page, older.title).locator('.unarchive-btn').click();
  await expect(titles(page)).toHaveText([]);
  await page.locator('#archived-filter').click();
  await expect(titles(page)).toHaveText([newer.title, older.title]);
  await expect(tabLabel(page, older.title)).toHaveCount(0);
  expect(await app.calls('toggleArchive')).toEqual([[older.id], [older.id]]);
});
