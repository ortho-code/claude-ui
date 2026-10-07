import { CONFIG_ROOT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A run is checked before it starts, and the check waits on main: a run asked for meanwhile takes its place, and the one it overtook never starts.
// A script, since a command line without a `cwd` asks main nothing, so its check never waits on main.
const fixture = {
  ...withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { script: 'scripts/status.sh' } }] },
      ],
    },
  }),
  paths: { [`${CONFIG_ROOT}/scripts/status.sh`]: 'executable' as const },
};

test('a command run overtaken while main is still answering its check never starts', async ({ app, page }) => {
  await app.boot(fixture);
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);

  const checked = (await app.calls('checkPath')).length;
  await app.hold('checkPath');
  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await refresh.click();
  await expect.poll(async () => (await app.calls('checkPath')).length).toBe(checked + 2);
  await app.release('checkPath');

  // Only the second press's run starts: both checks are answered at once, in order, so an overtaken run that started would already be there beside it.
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  expect(await runs(app, 'status')).toHaveLength(2);
});
