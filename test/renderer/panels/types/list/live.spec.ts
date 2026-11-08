import { session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { bootList, row, type PrintedList } from './list';

// A row's text may hold live values, which the app fills in from a session it has and keeps current between runs, and the session it names (`session`) shows its status dot in place of the mark for the sessions it started, a press on it marking it read as on every session dot (docs/panel-types.md § A text, § A row's session).
const named = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Fix the login redirect' });
const started = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Review #2' });
const GONE = '00000000-0000-4000-8000-0000000000ff';
const title = (id: string, otherwise?: string): Record<string, string> => ({ session: id, field: 'title', ...(otherwise !== undefined ? { else: otherwise } : {}) });
const more = { sessions: [named, started], history: { [named.id]: [], [started.id]: [] } };

const LIST: PrintedList = {
  version: 1,
  sections: [
    {
      items: [
        { key: 'named', session: named.id, text: ['Review: ', title(named.id)], detail: [[{ text: [title(named.id)], tooltip: ['About ', title(named.id)] }]] },
        { key: 'gone', session: GONE, text: ['Review: ', title(GONE, 'PR #36515')] },
        { key: 'unnamed', text: [title(GONE)] },
      ],
    },
  ],
};

test('a live title says what the app calls the session, among the words around it', async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  await expect(row(page, 'Review: Fix the login redirect')).toHaveCount(1);
  await expect(row(page, 'Review: Fix the login redirect').locator('.list-part')).toHaveText('Fix the login redirect');
});

test('a live title follows a rename without a run', async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  await app.listOnDisk([{ ...named, title: 'Fix the logout redirect' }, started]);
  await expect(row(page, 'Review: Fix the logout redirect')).toHaveCount(1);
  expect(await runs(app, 'changes')).toHaveLength(1);
});

test("a live title of a session the app does not have says the type's words, else Unavailable", async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  await expect(page.locator('.list-row .list-text')).toHaveText(['Review: Fix the login redirect', 'Review: PR #36515', 'Unavailable']);
});

test("a row naming a session shows its status dot, which follows its status", async ({ app, page }) => {
  await bootList(app, page, LIST, { more: { ...more, statuses: { [named.id]: 'waiting' } } });
  const dot = row(page, 'Review: Fix the login redirect').locator('.list-dot');
  await expect(dot.locator('.nudge')).toHaveClass(/\bwaiting\b/);
  await expect(dot).toHaveAttribute('aria-label', /^Fix the login redirect · /);
  await app.emit('onSessionStatus', named.id, 'idle', '', 'Stop');
  await expect(dot.locator('.nudge')).toHaveClass(/\bidle\b/);
});

test("a press on a named session's dot marks it read and unread again, and is not the row's press", async ({ app, page }) => {
  const pressing: PrintedList = { version: 1, sections: [{ items: [{ key: 'named', session: named.id, text: 'Review', press: { 'open-session': named.id } }] }] };
  await bootList(app, page, pressing, { more: { ...more, statuses: { [named.id]: 'waiting' } } });
  const nudge = row(page, 'Review').locator('.list-dot .nudge');
  await expect(nudge).not.toHaveClass(/\backed\b/);
  await nudge.click();
  await expect(nudge).toHaveClass(/\backed\b/);
  await nudge.click();
  await expect(nudge).not.toHaveClass(/\backed\b/);
  expect(await app.calls('startTerminal')).toHaveLength(0);
});

test("a press on a named session's dot with nothing to mark is the row's press", async ({ app, page }) => {
  const pressing: PrintedList = { version: 1, sections: [{ items: [{ key: 'named', session: named.id, text: 'Review', press: { 'open-session': named.id } }] }] };
  await bootList(app, page, pressing, { more: { ...more, statuses: { [named.id]: 'busy' } } });
  const nudge = row(page, 'Review').locator('.list-dot .nudge');
  // Forced, since a spinning dot never holds still for the wait Playwright makes before a click.
  await nudge.click({ force: true });
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(nudge).not.toHaveClass(/\backed\b/);
});

test('a row naming a session the app does not have shows no dot', async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  await expect(row(page, 'PR #36515').locator('.list-dot, .list-session')).toHaveCount(0);
});

test("the named session's dot takes the place of the mark for the session the row started", async ({ app, page }) => {
  const link = { key: 'named', label: 'named', href: null, startedAt: '2026-10-31T09:00:00.000Z' };
  await bootList(app, page, LIST, { more: { ...more, panelData: { changes: { sessions: { [started.id]: link }, lastGroup: {} } } } });
  const first = row(page, 'Review: Fix the login redirect');
  await expect(first.locator('.list-dot')).toHaveCount(1);
  await expect(first.locator('.list-session')).toHaveCount(0);
});

test("a part's live tooltip says the session's title", async ({ app, page }) => {
  await bootList(app, page, LIST, { more });
  await row(page, 'Review: Fix the login redirect').locator('.list-part').hover();
  await expect(page.locator('#tooltip')).toHaveText('About Fix the login redirect');
});
