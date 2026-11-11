import { session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { bootList, row, type PrintedList } from './list';

// The session a row names (`session`) shows its note mark beside its dot, as its own row in the session list does, the note on hover and a press opening it to edit (docs/panel-types.md § A row's session).
const noted = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'Fix the login redirect' });
const bare = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Tidy the docs' });
const more = { sessions: [noted, bare], history: { [noted.id]: [], [bare.id]: [] }, notes: { [noted.id]: 'Waiting on the review' } };

const LIST: PrintedList = {
  version: 1,
  sections: [
    {
      items: [
        { key: 'noted', session: noted.id, text: 'Noted', press: { 'open-session': noted.id } },
        { key: 'bare', session: bare.id, text: 'Bare' },
        { key: 'unnamed', text: 'Unnamed' },
      ],
    },
  ],
};

test("a row naming a session with a note shows the note mark, the note on hover; a row whose session has none, or that names none, shows no mark", async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  const mark = row(page, 'Noted').locator('.note-badge');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('data-tooltip', 'Waiting on the review');
  await expect(row(page, 'Bare').locator('.note-badge')).toBeHidden();
  await expect(row(page, 'Unnamed').locator('.note-badge:visible')).toHaveCount(0);
});

test("a press on the note mark opens the note to edit, not the row's press, and the mark follows the saved note without a run", async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  const mark = row(page, 'Noted').locator('.note-badge');
  await mark.click();
  await expect(page.locator('#rename-overlay')).toBeVisible();
  await expect(page.locator('#rename-textarea')).toHaveValue('Waiting on the review');
  await page.locator('#rename-textarea').fill('Merged, check the deploy');
  await page.locator('#rename-ok').click();
  await expect(page.locator('#rename-overlay')).toBeHidden();
  await expect(mark).toHaveAttribute('data-tooltip', 'Merged, check the deploy');
  expect(await app.calls('setNote')).toEqual([[noted.id, 'Merged, check the deploy']]);
  expect(await app.calls('startTerminal')).toHaveLength(0);
  expect(await runs(app, 'changes')).toHaveLength(1);
});
