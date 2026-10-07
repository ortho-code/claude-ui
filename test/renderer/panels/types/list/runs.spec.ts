import { CONFIG_ROOT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A run is checked before it starts, and the check waits on main: a run asked for meanwhile takes its place, and the one it overtook never starts.
const QUEUE_DIR = `${CONFIG_ROOT}/types/reviews`;
const queue = withLayout({
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
const fixture = {
  ...queue,
  layout: { ...queue.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read' as const, error: null, json: { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' } }] },
  paths: { [`${QUEUE_DIR}/list.sh`]: 'executable' as const },
  panelData: { queue: { sessions: {}, lastGroup: {} } },
};

test('a list run overtaken while main is still answering its check never starts', async ({ app, page }) => {
  await app.boot(fixture);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);

  const checked = (await app.calls('checkPath')).length;
  await app.hold('checkPath');
  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await refresh.click();
  await expect.poll(async () => (await app.calls('checkPath')).length).toBe(checked + 2);
  await app.release('checkPath');

  // Only the second press's run starts: both checks are answered at once, in order, so an overtaken run that started would already be there beside it.
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  expect(await runs(app, 'queue')).toHaveLength(2);
});
