import type { Locator, Page } from '@playwright/test';
import { CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A list panel of a type from the config folder, booted with what its script prints, for the checks of what a list draws.

const TYPE_DIR = `${CONFIG_ROOT}/types/changes`;
const fixture = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '360px', panels: [{ id: 'changes', type: 'changes' }] },
    ],
  },
});

/** What a check hands the script to print: a list document, loosely typed, since a check may print one the app refuses. */
export interface PrintedList {
  version: number;
  sections: { items: PrintedItem[]; [field: string]: unknown }[];
  [field: string]: unknown;
}

export interface PrintedItem {
  key: string;
  [field: string]: unknown;
}

/** Boot with the panel, let its script print `list`, and wait for its rows. */
export async function bootList(app: App, page: Page, list: PrintedList): Promise<void> {
  await app.boot({ ...fixture, layout: { ...fixture.layout, types: [{ name: 'changes', dir: TYPE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Changes', icon: 'git', run: 'list.mjs' } }] }, paths: { [`${TYPE_DIR}/list.mjs`]: 'executable' }, panelData: { changes: { sessions: {}, lastGroup: {} } } });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(1);
  const { token: run } = (await runs(app, 'changes'))[0];
  await app.emit('onPanelRun', 'changes', run, { kind: 'output', text: JSON.stringify(list) });
  await app.emit('onPanelRun', 'changes', run, { kind: 'exit', code: 0, signal: null });
  await expect(page.locator('.list-row')).toHaveCount(list.sections.reduce((count, { items }) => count + items.length, 0));
}

/** The row whose text holds `text`. */
export const row = (page: Page, text: string): Locator => page.locator('.list-row', { hasText: text });
