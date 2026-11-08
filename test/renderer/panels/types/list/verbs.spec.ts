import type { Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../src/shared/types';
import { session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { tab } from '../../../support/window';
import { bootList, row, type PrintedList } from './list';

// What a press does is the type's, from one vocabulary of verbs (docs/panel-types.md § A verb): an action's button, a press on a row and a press on a part each name one, and each verb does the same wherever it is pressed.

const waiting = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Fix the importer' });
const PAGE = 'https://example.com/page';

/** One row printed with `over`, its text saying what it is for. */
const one = (over: Record<string, unknown>): PrintedList => ({ version: 1, sections: [{ items: [{ key: 'r', text: 'The row', ...over }] }] });

/** What the clipboard holds, read as a paste would; the page may read it only once both permissions are granted. */
async function clipboard(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test("a row whose press is open-session goes to that session: its tab opens, resumed, on show", async ({ app, page }) => {
  await bootList(app, page, one({ press: { 'open-session': waiting.id } }), { more: { sessions: [waiting], history: { [waiting.id]: [] } } });
  await row(page, 'The row').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(waiting.id);
  await expect(tab(page, waiting.title)).toHaveClass(/\bactive\b/);
});

test('an open-session naming an id the app has no session for says so, and opens nothing', async ({ app, page }) => {
  await bootList(app, page, one({ actions: [{ label: 'Open', 'open-session': 'b03e5cdc' }] }));
  await row(page, 'The row').getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('#toast-message')).toHaveText('That session is not in the app.');
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("a copy puts its text on the clipboard and says so in the type's words, or the app's without them, a part's press winning over the row's", async ({ app, page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await bootList(app, page, one({ press: { 'open-url': PAGE }, detail: [[{ text: 'b03e5cdc', press: { copy: { text: 'b03e5cdc', confirm: 'Session id copied.' } } }]], actions: [{ label: 'Copy title', copy: 'The row' }] }));
  const story = row(page, 'The row');
  await story.getByRole('button', { name: 'b03e5cdc' }).click();
  await expect(page.locator('#toast-message')).toHaveText('Session id copied.');
  expect(await clipboard(page)).toBe('b03e5cdc');
  expect(await app.calls('openExternal')).toEqual([]);

  await story.locator('.list-action').click();
  await expect(page.locator('#toast-message')).toHaveText('Copied.');
  expect(await clipboard(page)).toBe('The row');
});

test("a press of open-url opens its link, and a part's stays a link a middle-click opens", async ({ app, page }) => {
  await bootList(app, page, one({ press: { 'open-url': PAGE }, detail: [[{ text: 'Its epic', press: { 'open-url': 'https://example.com/epic' } }]] }));
  const story = row(page, 'The row');
  await story.locator('.card-title').click();
  await story.getByRole('link', { name: 'Its epic' }).click({ button: 'middle' });
  expect(await app.calls('openExternal')).toEqual([[PAGE], ['https://example.com/epic']]);
});

test("a row whose press is a session asks for it through the app's dialog, as the action does", async ({ app, page }) => {
  await bootList(app, page, one({ press: { session: { prompt: '/research sc-1' } } }));
  await row(page, 'The row').click();
  await expect(page.locator('#session-overlay')).toBeVisible();
  await expect(page.locator('#session-prompt')).toHaveValue('/research sc-1');
});

test('a part whose press is another verb looks like a link beside it: underlined, under a pointer, in a row that is not pressable itself', async ({ app, page }) => {
  await bootList(app, page, one({ detail: [[{ text: 'PR #1', press: { 'open-url': PAGE } }, { text: 'copy id', press: { copy: 'b03e5cdc' } }]] }));
  const story = row(page, 'The row');
  const look = (name: string): Promise<[string, string, string]> =>
    story.getByText(name, { exact: true }).evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.textDecorationLine, style.cursor, style.color];
    });
  expect(await look('copy id')).toEqual(await look('PR #1'));
  expect((await look('copy id')).slice(0, 2)).toEqual(['underline', 'pointer']);
});

test('a press of a verb this build does not have is no press: a row holding rows folds them, as one without a press does', async ({ app, page }) => {
  await bootList(app, page, one({ press: { merge: {} }, children: [{ key: 'c', text: 'The child' }] }));
  await row(page, 'The row').locator('.card-title').click();
  await expect(row(page, 'The child')).toHaveCount(0);
});
