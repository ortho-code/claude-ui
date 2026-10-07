import { type BridgeFixture, CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { railItem, runs, withLayout } from '../../layout/layout';

// A list panel with an interval runs on it as well as on show (docs/architecture.md § Types from the config folder, When it runs): from when the window goes live, shown or not, and a tick after each run ends, out of sight too.
const QUEUE_DIR = `${CONFIG_ROOT}/types/reviews`;
const SCRIPT = `${QUEUE_DIR}/list.sh`;
const MINUTE = 60_000;

/** A command on show and the queue behind it, so the queue is out of sight from the start; its type's manifest gives `interval` when one is passed. */
function queueBehind(interval?: string): ReturnType<typeof withLayout> {
  const base = withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        {
          id: 'right',
          size: '360px',
          panels: [
            { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } },
            { id: 'queue', type: 'reviews' },
          ],
        },
      ],
    },
  });
  const manifest = { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh', ...(interval ? { interval } : {}) };
  return { ...base, layout: { ...base.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: manifest }] } };
}

const fixture = (interval?: string): Partial<BridgeFixture> => ({ ...queueBehind(interval), paths: { [SCRIPT]: 'executable' as const }, panelData: { queue: { sessions: {}, lastGroup: {} } } });

/** End the queue's latest run as its script would: a list and exit 0, or exit `code` having printed nothing. */
async function finish(app: App, code = 0): Promise<void> {
  const { token } = (await runs(app, 'queue')).at(-1)!;
  if (code === 0) await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: JSON.stringify({ version: 1, sections: [{ items: [{ key: 'a', text: 'A row' }] }] }) });
  await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code, signal: null });
}

test('a list panel with an interval runs when the window goes live though out of sight, and a tick after each run ends, failed or not', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture('1m'));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect(railItem(page, /^Reviews/)).not.toHaveClass(/\bshown\b/);

  // The interval counts from a run's end, so a run still going holds the next one back however long it takes.
  await page.clock.fastForward(2 * MINUTE);
  expect(await runs(app, 'queue')).toHaveLength(1);
  await finish(app);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);

  await finish(app, 1);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(3);
  await expect(railItem(page, /^Reviews/)).not.toHaveClass(/\bshown\b/);
});

test('a press of Refresh puts off the tick due during its run, to a tick after it ends', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture('1m'));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await finish(app);
  // On show, in the folder it last ran in: nothing to run.
  await railItem(page, /^Reviews/).click();
  await expect(railItem(page, /^Reviews/)).toHaveClass(/\bshown\b/);

  await page.clock.fastForward(MINUTE / 2);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  // Past when the tick was due, with the pressed run still going: the tick does not run over it.
  await page.clock.fastForward(MINUTE);
  expect(await runs(app, 'queue')).toHaveLength(2);

  await finish(app);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(3);
});

test('a run ending while the press that replaces it is still being checked sets no tick over the pressed run', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture('1m'));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await railItem(page, /^Reviews/).click();
  await expect(railItem(page, /^Reviews/)).toHaveClass(/\bshown\b/);

  // Pressed while the first run is still going; main has not answered the press's check yet when the first run ends.
  const checked = (await app.calls('checkPath')).length;
  await app.hold('checkPath');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(async () => (await app.calls('checkPath')).length).toBe(checked + 1);
  await finish(app);
  await app.release('checkPath');
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);

  // The first run's end was for a run the press replaced: no tick from it runs over the pressed run.
  await page.clock.fastForward(2 * MINUTE);
  expect(await runs(app, 'queue')).toHaveLength(2);
  await finish(app);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(3);
});

test('a list panel without an interval does not run out of sight', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture());
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await page.clock.fastForward(60 * MINUTE);
  expect(await runs(app, 'queue')).toEqual([]);

  await railItem(page, /^Reviews/).click();
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
});

test('a list panel with an interval that could not run runs as soon as it can, out of sight', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...fixture('1m'), paths: {} });
  // The panel checks itself at once, and finds no script.
  await expect.poll(async () => (await app.calls('checkPath')).some(([value]) => value === 'list.sh')).toBe(true);
  // Never started, so not ticked either.
  await page.clock.fastForward(5 * MINUTE);
  expect(await runs(app, 'queue')).toEqual([]);

  // The script appearing is a change in the config folder, which every panel checks again on.
  await page.evaluate((script) => (window.__claudeUiFixture.paths[script] = 'executable'), SCRIPT);
  expect(await app.emit('onLayoutChanged', queueBehind('1m').layout)).toBe(1);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect(railItem(page, /^Reviews/)).not.toHaveClass(/\bshown\b/);
});
