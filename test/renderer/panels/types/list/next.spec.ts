import type { Page } from '@playwright/test';
import { type BridgeFixture, CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A list panel's run may say when it runs next too, by the rule a command panel's runs follow (`PanelRuns`); what its control file gets wrong sits beside the type's and the list's own notes.
const QUEUE_DIR = `${CONFIG_ROOT}/panel-types/reviews`;
const MINUTE = 60_000;

/** The queue on show; its type's manifest gives `interval`, and a field this build does not read, for a note of the type's own. */
function fixture(interval?: string): Partial<BridgeFixture> {
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
  const manifest = { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh', colour: 'blue', ...(interval ? { interval } : {}) };
  return {
    ...base,
    layout: { ...base.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: manifest }] },
    paths: { [`${QUEUE_DIR}/list.sh`]: 'executable' },
    panelData: { queue: { sessions: {}, lastGroup: {} } },
  };
}

/** End the queue's latest run with a list carrying a note of its own, and what it wrote to its control file, or nothing. */
async function finish(app: App, control?: string): Promise<void> {
  const { token } = (await runs(app, 'queue')).at(-1)!;
  await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: JSON.stringify({ version: 1, notes: ['From the list.'], sections: [{ items: [{ key: 'a', text: 'A row' }] }] }) });
  await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code: 0, signal: null, ...(control === undefined ? {} : { control }) });
}

const note = (page: Page, text: string): ReturnType<Page['getByText']> => page.locator('.panel-note').getByText(text);

test('a list run that says when it runs next is run again then, in place of the interval', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture('1h'));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await finish(app, 'next=1m\n');
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
});

test("what a list run's control file gets wrong sits beside the type's notes and the list's, and goes with a run that writes none", async ({ app, page }) => {
  await app.boot(fixture());
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  const typeNote = note(page, 'panel-types/reviews/panel.json: colour is not a field this build reads; it is ignored.');
  const controlNote = note(page, 'queue: CLAUDE_UI_CONTROL: when is not a name this build reads; it is ignored.');
  await expect(typeNote).toBeVisible();

  await finish(app, 'when=later\n');
  await expect(controlNote).toBeVisible();
  await expect(typeNote).toBeVisible();
  await expect(note(page, 'From the list.')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  await finish(app);
  await expect(controlNote).toBeHidden();
  await expect(typeNote).toBeVisible();
  await expect(note(page, 'From the list.')).toBeVisible();
});
