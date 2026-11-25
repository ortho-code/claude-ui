import { defaultUi } from '../../../../../src/shared/config/defaults';
import type { Exchange } from '../../../../../src/shared/types';
import { session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { row, tab, tabs } from '../../../support/window';

// A session with an older copy of its transcript, one another copy replaced, carries a mark on its row saying what that copy holds that the session's history lacks, until Claude Code's cleanup deletes it (docs/architecture/sessions.md § Superseded copies).
const COPY = { stamp: '1795440916583', at: 1795440916583, missing: 67 };
const split = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Split session', supersededCopies: [COPY] });
const whole = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Whole session' });

test('a session with an older copy of its transcript says on its row how many requests that copy holds that its history lacks', async ({ app, page }) => {
  await app.boot({ sessions: [split, whole] });
  const mark = row(page, split.title).locator('.superseded-mark');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveClass(/\bsuperseded-badge\b/);
  await expect(mark).toHaveAttribute('data-tooltip', /^An older copy of this session, replaced .+, has 67 requests the current one lacks\.\nClick to read it in the history\.$/);
  await expect(row(page, whole.title).locator('.superseded-mark')).toBeHidden();
});

test('the mark comes with a copy and goes once Claude Code has deleted it', async ({ app, page }) => {
  await app.boot({ sessions: [whole] });
  const mark = row(page, whole.title).locator('.superseded-mark');
  await expect(mark).toBeHidden();
  await app.listOnDisk([{ ...whole, supersededCopies: [{ ...COPY, missing: 1 }] }]);
  await expect(mark).toHaveAttribute('data-tooltip', /has 1 request the current one lacks\.\nClick to read it in the history\.$/);
  await app.listOnDisk([whole]);
  await expect(mark).toBeHidden();
});

test("a press on the mark reads the copy in the session's history, without starting claude", async ({ app, page }) => {
  const exchange = (id: string): Exchange => ({ id, time: '2026-11-23T11:16:00.000Z', request: `Request ${id}`, kind: 'typed', replaced: false, rewound: false, parts: [] });
  await app.boot({ sessions: [split], history: { [split.id]: [exchange('now')] }, copies: { [`${split.id}:${COPY.stamp}`]: { exchanges: [exchange('then')], notInCurrent: ['then'] } } });
  await row(page, split.title).locator('.superseded-mark').click();
  await expect(tab(page, split.title)).toHaveClass(/\bactive\b/);
  await expect(page.locator('.history .exchange-request-text')).toHaveText(['Request then']);
  await expect(page.locator('.history-copies .history-filter[aria-pressed="true"]')).toHaveText(/^Older copy/);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('in the finished view the mark only says what the copy holds, and a press on it opens nothing, as a press on the row does not', async ({ app, page }) => {
  await app.boot({ sessions: [split], finished: { [split.id]: Date.parse('2026-11-24T08:00:00.000Z') }, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, finished: true } } });
  const mark = row(page, split.title).locator('.superseded-mark');
  await expect(mark).toHaveAttribute('data-tooltip', /^An older copy of this session, replaced .+, has 67 requests the current one lacks\.$/);
  await mark.click();
  await expect(tabs(page)).toHaveCount(0);
  expect((await app.calls('setOpenSessions')).flat(2)).not.toContain(split.id);
});
