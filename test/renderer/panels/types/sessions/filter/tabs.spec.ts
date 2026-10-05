import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import type { UiState } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { tabLabel, tabs, titles } from '../../../../support/window';

// Two filters are questions about the TABS rather than the sessions: "open" shows the sessions with a tab, "live" the ones with a claude running.
// So the list they filter has to follow the tabs as they open, start, stop and close.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Another session' });
const fixture = { sessions: [one, two], history: { [one.id]: [], [two.id]: [] }, openSessions: [one.id] };
const withFilter = (filter: 'open' | 'live'): { uiState: UiState } => ({ uiState: { ...defaultUi(), filters: { ...defaultUi().filters, [filter]: true } } });

const tabButton = (page: Page): Locator => tabs(page).locator('.tab-close');

test('with "open" on, closing the last tab takes its row out of the list', async ({ app, page }) => {
  await app.boot({ ...fixture, ...withFilter('open') });
  await expect(titles(page)).toHaveText([one.title]);
  // Cold, so one press closes it.
  await tabButton(page).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(titles(page)).toHaveText([]);
});

test('with "live" on, starting a tab puts its row in the list, and stopping it takes the row out', async ({ app, page }) => {
  await app.boot({ ...fixture, ...withFilter('live') });
  await expect(titles(page)).toHaveText([]);

  await tabLabel(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(titles(page)).toHaveText([one.title]);

  await tabButton(page).click();
  await app.emit('onTerminalExit', 1, 0);
  await expect(tabs(page)).toHaveClass(/\bcold\b/);
  await expect(titles(page)).toHaveText([]);
});
