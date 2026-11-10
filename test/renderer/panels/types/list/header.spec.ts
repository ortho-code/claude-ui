import { expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { layoutWith, print } from './list';
import { CONFIG_ROOT } from '../../../support/fixture';

// What a list panel's header says of it as it runs: the spinner while a run is under way, and the count its list gives beside its title.
const SCRIPT = `${CONFIG_ROOT}/panel-types/changes/list.mjs`;

test("a list panel's header spins while it runs, and shows the count its list gives beside its title once the run is done", async ({ app, page }) => {
  await app.boot({ ...layoutWith(), paths: { [SCRIPT]: 'executable' }, panelData: { changes: { sessions: {}, lastGroup: {} } } });
  const header = page.locator('.panel-header', { has: page.locator('.panel-title', { hasText: 'Changes' }) });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(1);
  await expect(header.locator('.nudge.running')).toBeVisible();
  await expect(header.locator('.panel-count')).toBeHidden();

  await print(app, 0, { version: 1, badge: 7, sections: [{ items: [{ key: 'a', text: 'A row' }] }] });
  await expect(header.locator('.nudge.running')).toBeHidden();
  await expect(header.locator('.panel-count')).toHaveText('7');
});

test('a list that gives no count shows none beside its title', async ({ app, page }) => {
  await app.boot({ ...layoutWith(), paths: { [SCRIPT]: 'executable' }, panelData: { changes: { sessions: {}, lastGroup: {} } } });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(1);
  await print(app, 0, { version: 1, sections: [{ items: [{ key: 'a', text: 'A row' }] }] });
  await expect(page.locator('.list-row')).toHaveCount(1);
  await expect(page.locator('.panel-header .panel-count')).toBeHidden();
});
