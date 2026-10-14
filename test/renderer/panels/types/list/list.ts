import type { Locator, Page } from '@playwright/test';
import type { NodeState } from '../../../../../src/shared/panels';
import { CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A list panel of a type from the config folder, booted with what its script prints, for the checks of what a list draws.

const TYPE_DIR = `${CONFIG_ROOT}/panel-types/changes`;

/**
 * The window with the panel, `changes`, on the right, and its type read from the config folder: its entry with `entry` added, and `nodes` as the app's file beside the layout keeps them.
 * Also what a check hands the window as the layout file edited while it runs (`onLayoutChanged`).
 */
export function layoutWith(entry: Record<string, unknown> = {}, nodes?: Record<string, NodeState>): ReturnType<typeof withLayout> {
  const fixture = withLayout(
    {
      version: 2,
      root: {
        id: 'window',
        columns: [
          { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
          { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
          { id: 'right', size: '360px', panels: [{ id: 'changes', type: 'changes', ...entry }] },
        ],
      },
    },
    nodes,
  );
  return { ...fixture, layout: { ...fixture.layout, types: [{ name: 'changes', dir: TYPE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Changes', icon: 'git', run: 'list.mjs' } }] } };
}

/** What a check boots the panel with besides its list: fields of its layout entry, and what the app has kept for nodes. */
export interface ListSetup {
  entry?: Record<string, unknown>;
  nodes?: Record<string, NodeState>;
}

/** What a check hands the script to print: a list document, loosely typed, since a check may print one the app refuses. */
export interface PrintedList {
  version: number;
  sections: { items: PrintedItem[]; [field: string]: unknown }[];
  [field: string]: unknown;
}

export interface PrintedItem {
  key: string;
  shut?: boolean;
  children?: PrintedItem[];
  [field: string]: unknown;
}

/** The rows a list draws: every item of a section that is not shut, and the items under one that is not shut. */
const drawn = (items: PrintedItem[]): number => items.reduce((count, item) => count + 1 + (item.shut ? 0 : drawn(item.children ?? [])), 0);

/** Boot with the panel, let its script print `list`, and wait for its rows. */
export async function bootList(app: App, page: Page, list: PrintedList, { entry = {}, nodes }: ListSetup = {}): Promise<void> {
  await app.boot({ ...layoutWith(entry, nodes), paths: { [`${TYPE_DIR}/list.mjs`]: 'executable' }, panelData: { changes: { sessions: {}, lastGroup: {} } } });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(1);
  await print(app, 0, list);
  await expect(page.locator('.list-row')).toHaveCount(list.sections.reduce((count, { items, shut }) => count + (shut === true ? 0 : drawn(items)), 0));
}

/** Let the panel's run at `index` print `list` and end well. */
export async function print(app: App, index: number, list: PrintedList): Promise<void> {
  const { token } = (await runs(app, 'changes'))[index];
  await app.emit('onPanelRun', 'changes', token, { kind: 'output', text: JSON.stringify(list) });
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 0, signal: null });
}

/** The row whose text holds `text`. */
export const row = (page: Page, text: string): Locator => page.locator('.list-row', { hasText: text });
