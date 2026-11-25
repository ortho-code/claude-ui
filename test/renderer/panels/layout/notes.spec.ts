import { CONFIG_ROOT } from '../../support/fixture';
import { expect, test } from '../../support/harness';
import { LAYOUT, railItem, runs, withLayout } from './layout';

// The notes under a group: a panel's own only while it is on show, the layout file's always, and a line of many that never pushes the panel's content under its header.

const CONTROL_NOTE = 'status: CLAUDE_UI_CONTROL: when is not a name this build reads; it is ignored.';

test("a panel's own notes show only while it is on show, and come back with it", async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  const { token } = (await runs(app, 'status'))[0];
  await app.emit('onPanelRun', 'status', token, { kind: 'exit', code: 0, signal: null, control: 'when=later\n' });
  const note = page.locator('.panel-note').getByText(CONTROL_NOTE);
  await expect(note).toBeVisible();

  await railItem(page, /^Checks/).click();
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect(note).toHaveCount(0);

  await railItem(page, /^Status/).click();
  await expect(note).toBeVisible();
});

const QUEUE_DIR = `${CONFIG_ROOT}/panel-types/reviews`;

test('a long line of notes scrolls within part of the group, leaving the list in view under its header', async ({ app, page }) => {
  const base = withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'queue', type: 'reviews' }] },
      ],
    },
  });
  const manifest = { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' };
  await app.boot({
    ...base,
    layout: { ...base.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: manifest }] },
    paths: { [`${QUEUE_DIR}/list.sh`]: 'executable' },
    panelData: { queue: { sessions: {}, lastGroup: {} } },
  });
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  const { token } = (await runs(app, 'queue')).at(-1)!;
  const notes = Array.from({ length: 30 }, (_, n) => `Could not ask about repository ${n}, so its branches ready to delete may be missing from the list.`);
  await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: JSON.stringify({ version: 1, notes, sections: [{ items: [{ key: 'a', text: 'A row' }] }] }) });
  await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code: 0, signal: null });

  // A failed run's line wears the same class, hidden while the run did not fail.
  const line = page.locator('.panel-note:not(.list-failed)');
  await expect(line.getByText(notes[0])).toBeVisible();
  const group = (await page.locator('.panel-group', { has: line }).boundingBox())!;
  const box = (await line.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(group.height * 0.4 + 1);
  expect(await line.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const header = (await page.locator('.panel-group', { has: line }).locator('.panel-header').boundingBox())!;
  const row = (await page.getByText('A row').boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(row.y + row.height).toBeLessThanOrEqual(box.y + 1);
});
