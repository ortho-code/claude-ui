import type { Page } from '@playwright/test';
import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { here } from '../../layout/layout';
import { bootDiff, file, rows, summary } from './diff';

// The diff panel reads its list again, unasked, when the checkout's working tree changes, looked at every 30 s, and when the session on show ends a turn, so the list keeps up while you work beside it.

const POLL = 30_000;
const reads = async (app: App): Promise<number> => (await app.calls('diffSummary')).length;

/** What main's reads now answer for Since branched in the project, without telling the window. */
const nowLists = (page: Page, paths: string[]): Promise<void> =>
  page.evaluate(
    ([dir, listed]) => void (window.__claudeUiFixture.diffs[dir].since = listed),
    [PROJECT, summary({ files: paths.map((path) => file(path)) })] as const,
  );

test('a change in the working tree reads the list again once a second look finds it still', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, { since: summary({ files: [file('a.txt')] }) }, { tree: 'clean' });
  await expect(rows(page)).toHaveCount(1);
  const before = await reads(app);

  await nowLists(page, ['a.txt', 'b.txt']);
  await page.evaluate((dir) => void (window.__claudeUiFixture.trees[dir] = 'edited'), PROJECT);
  await page.clock.fastForward(POLL);
  expect(await reads(app)).toBe(before);
  await page.clock.fastForward(POLL);
  await expect(rows(page)).toHaveCount(2);
});

test('the session on show ending a turn reads the list again', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, { since: summary({ files: [file('a.txt')] }) });
  await expect(rows(page)).toHaveCount(1);
  await app.emit('onSessionStatus', here.id, 'busy', '', 'UserPromptSubmit');
  await page.clock.fastForward(3_000);

  await nowLists(page, ['a.txt', 'b.txt']);
  await app.emit('onSessionStatus', here.id, 'idle', '', 'Stop');
  await page.clock.fastForward(3_000);
  await expect(rows(page)).toHaveCount(2);
});
