import type { Locator, Page } from '@playwright/test';
import type { Exchange, SupersededCopy } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { tab } from '../../../../support/window';

// A session with an older copy of its transcript can show that copy in its history, read-only, its requests the current transcript lacks edged (docs/architecture/history.md § An older copy).
const TIME = '2026-11-23T11:16:00.000Z';
const exchange = (id: string): Exchange => ({ id, time: TIME, request: `Request ${id}`, kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'text', id: `message-${id}`, time: TIME, text: `Reply ${id}` }] });
const COPY: SupersededCopy = { stamp: '1795440916583', at: 1795440916583, missing: 2 };
const one = session({ supersededCopies: [COPY] });
const fixture = {
  sessions: [one],
  openSessions: [one.id],
  activeSession: one.id,
  history: { [one.id]: ['shared', 'after'].map(exchange) },
  copies: { [`${one.id}:${COPY.stamp}`]: { exchanges: ['before-1', 'shared', 'before-2'].map(exchange), notInCurrent: ['before-1', 'before-2'] } },
};

const choice = (page: Page, label: RegExp): Locator => page.locator('.history-copies .history-filter', { hasText: label });
const requests = (page: Page): Locator => page.locator('.exchange .exchange-request-text');
/** How each request's pin star is laid out: none where pinning is off, whatever a hover would show. */
const pinDisplays = (page: Page): Promise<string[]> => page.locator('.exchange-request .exchange-pin').evaluateAll((pins) => pins.map((pin) => getComputedStyle(pin).display));

test('the history of a session with an older copy switches to that copy, read-only, edging what the current transcript lacks, and back', async ({ app, page }) => {
  await app.boot(fixture);
  await page.getByRole('button', { name: 'Show history' }).click();
  await expect(requests(page)).toHaveText(['Request shared', 'Request after']);
  await expect(choice(page, /^Current$/)).toHaveAttribute('aria-pressed', 'true');
  await expect(choice(page, /^Older copy, .+ · 2 not in current$/)).toHaveAttribute('aria-pressed', 'false');

  await choice(page, /^Older copy/).click();
  await expect(requests(page)).toHaveText(['Request before-1', 'Request shared', 'Request before-2']);
  await expect(page.locator('.exchange.not-in-current .exchange-request-text')).toHaveText(['Request before-1', 'Request before-2']);
  await expect(page.locator('.history-copy-note')).toHaveText(/^Read-only\. An older copy of this session, replaced .+, which Claude Code deletes later\./);
  expect(new Set(await pinDisplays(page))).toEqual(new Set(['none']));

  await choice(page, /^Current$/).click();
  await expect(requests(page)).toHaveText(['Request shared', 'Request after']);
  await expect(page.locator('.history-copy-note')).toBeHidden();
  expect(await pinDisplays(page)).not.toContain('none');
});

test('a tab left with an older copy on show comes back on its transcript, at its end, not at where the copy was', async ({ app, page }) => {
  const long = (id: string): Exchange => ({ ...exchange(id), parts: [{ kind: 'text', id: `message-${id}`, time: TIME, text: Array.from({ length: 40 }, (_, line) => `Line ${line + 1}`).join('\n\n') }] });
  const other = session({ id: '00000000-0000-4000-8000-0000000000c3', title: 'Other' });
  await app.boot({
    ...fixture,
    sessions: [one, other],
    openSessions: [one.id, other.id],
    history: { [one.id]: ['t1', 't2', 't3', 't4'].map(long), [other.id]: [] },
    copies: { [`${one.id}:${COPY.stamp}`]: { exchanges: ['c1', 'c2', 'c3', 'c4'].map(long), notInCurrent: ['c1', 'c2', 'c3', 'c4'] } },
  });
  await page.getByRole('button', { name: 'Show history' }).click();
  await choice(page, /^Older copy/).click();
  await expect(requests(page)).toHaveText(['Request c1', 'Request c2', 'Request c3', 'Request c4']);
  await page.locator('.history-scroll').evaluate((scroller) => (scroller.scrollTop = 0));

  await tab(page, other.title).click();
  await tab(page, one.title).click();
  await expect(requests(page)).toHaveText(['Request t1', 'Request t2', 'Request t3', 'Request t4']);
  await expect(choice(page, /^Current$/)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.history-scroll').evaluate((scroller) => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4)).toBe(true);
});

test('a session without an older copy has no switch', async ({ app, page }) => {
  const whole = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'Whole' });
  await app.boot({ sessions: [whole], openSessions: [whole.id], activeSession: whole.id, history: { [whole.id]: ['1'].map(exchange) } });
  await page.getByRole('button', { name: 'Show history' }).click();
  await expect(requests(page)).toHaveText(['Request 1']);
  await expect(page.locator('.history-copies')).toBeHidden();
});

test('a copy on show that Claude Code deletes gives way to the transcript', async ({ app, page }) => {
  await app.boot(fixture);
  await page.getByRole('button', { name: 'Show history' }).click();
  await choice(page, /^Older copy/).click();
  await expect(requests(page)).toHaveCount(3);
  await app.listOnDisk([{ ...one, supersededCopies: [] }]);
  await expect(requests(page)).toHaveText(['Request shared', 'Request after']);
  await expect(page.locator('.history-copies')).toBeHidden();
  await expect(page.locator('.history-copy-note')).toBeHidden();
});
