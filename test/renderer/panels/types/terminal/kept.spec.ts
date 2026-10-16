import type { PanelShells } from '../../../../../src/shared/panels';
import { PROJECT, session } from '../../../support/fixture';
import { expect, test, type App } from '../../../support/harness';
import { panelTab, panelTabAdd, panelTabLabels } from '../../../support/window';
import { OTHER, railItem, withLayout } from '../../layout/layout';

// A terminal panel's shells are kept for the next launch, in the panel's own data, and come back as tabs with no shell, each starting where it was (docs/architecture.md § The `terminal` type).
const API = `${PROJECT}/api`;

const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      {
        id: 'right',
        size: '420px',
        panels: [
          { id: 'shell', type: 'terminal', title: 'Shell' },
          { id: 'status', type: 'command', title: 'Status', options: { command: 'git status --short' } },
        ],
      },
    ],
  },
});

const KEPT: PanelShells = {
  list: [
    { id: 'a', name: 'demo', project: PROJECT, folder: PROJECT },
    { id: 'b', name: 'api', project: PROJECT, folder: API },
  ],
  shown: { [PROJECT]: 'b' },
};

/** The layout with `shells` kept for the shell panel, and the api folder there. */
const withKept = (shells: PanelShells): ReturnType<typeof withLayout> & Record<string, unknown> => ({
  ...layout,
  panelData: { shell: { sessions: {}, lastGroup: {}, shells } },
  paths: { [API]: 'directory' },
});

/** Every shell start so far: its folder and the owner it was started for. */
const starts = async (app: App): Promise<unknown[][]> => (await app.calls('startShell')).map(([cwd, , owner]) => [cwd, owner]);

/** The context each shell start so far was handed, which its `CLAUDE_UI_*` variables are made from. */
const contexts = async (app: App): Promise<unknown[]> => (await app.calls('startShell')).map(([, context]) => context);

/** What the window last asked main to keep of the panel's shells. */
const lastKept = async (app: App): Promise<PanelShells | undefined> => (await app.calls('setPanelShells')).at(-1)?.[1] as PanelShells | undefined;

test('kept shells come back as tabs: the one on show starts where it was, the others when picked, and no other is made beside them', async ({ app, page }) => {
  await app.boot(withKept(KEPT));
  await expect(panelTabLabels(page)).toHaveText(['demo', 'api']);
  await expect(panelTab(page, 'api')).toHaveClass(/\bactive\b/);
  await expect.poll(() => starts(app)).toEqual([[API, { entryId: 'shell', shellId: 'b' }]]);
  await expect(panelTab(page, 'demo')).toHaveClass(/\bcold\b/);

  await panelTab(page, 'demo').click();
  await expect.poll(() => starts(app)).toEqual([
    [API, { entryId: 'shell', shellId: 'b' }],
    [PROJECT, { entryId: 'shell', shellId: 'a' }],
  ]);
  await expect(panelTab(page, 'demo')).not.toHaveClass(/\bcold\b/);
});

test('what you change is kept: a new shell, a rename, the tab on show and a close', async ({ app, page }) => {
  await app.boot(withKept(KEPT));
  await expect(panelTabLabels(page)).toHaveText(['demo', 'api']);

  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'api', 'demo 2']);
  await expect.poll(async () => (await lastKept(app))?.list.map(({ name, folder }) => [name, folder])).toEqual([
    ['demo', PROJECT],
    ['api', API],
    ['demo 2', PROJECT],
  ]);
  const made = (await lastKept(app))!.list[2].id;
  expect((await lastKept(app))!.shown[PROJECT]).toBe(made);

  await panelTab(page, 'api').locator('.tab-label').dblclick();
  await page.locator('#rename-input').fill('backend');
  await page.locator('#rename-ok').click();
  await expect.poll(async () => (await lastKept(app))?.list.map(({ name }) => name)).toEqual(['demo', 'backend', 'demo 2']);
  expect((await lastKept(app))!.shown[PROJECT]).toBe('b');

  await panelTab(page, 'demo').locator('.tab-close').click();
  await expect.poll(async () => (await lastKept(app))?.list.map(({ id }) => id)).toEqual(['b', made]);
});

test('nothing is kept once the app is quitting, so the quit cannot write over what it found', async ({ app, page }) => {
  await app.boot(withKept(KEPT));
  await expect(panelTabLabels(page)).toHaveText(['demo', 'api']);
  // A pick is kept, which shows the panel keeping at all before the quit.
  await panelTab(page, 'demo').click();
  await expect.poll(async () => (await lastKept(app))?.shown[PROJECT]).toBe('a');
  const kept = (await app.calls('setPanelShells')).length;

  await app.emit('onQuitting');
  await panelTabAdd(page).click();
  await expect(panelTabLabels(page)).toHaveText(['demo', 'api', 'demo 2']);
  expect(await app.calls('setPanelShells')).toHaveLength(kept);
});

// A shell belongs to its project, so its variables name that project whatever is selected when it starts, and the session on show only where that session is in it.
test("a shell started in All has its own project's variables, not those of the tab on show", async ({ app, page }) => {
  const here = session();
  const shells: PanelShells = {
    list: [
      { id: 'a', name: 'demo', project: PROJECT, folder: PROJECT },
      { id: 'o', name: 'other', project: OTHER, folder: OTHER },
    ],
    shown: {},
  };
  await app.boot({ ...withKept(shells), activeProject: null, openSessions: [here.id], activeSession: here.id, activeSessionByProject: {}, history: { [here.id]: [] } });
  await expect(panelTabLabels(page)).toHaveText(['demo', 'other']);
  await expect.poll(() => contexts(app)).toEqual([{ projectRoot: PROJECT, cwd: PROJECT, sessionId: here.id }]);

  await panelTab(page, 'other').click();
  await expect.poll(() => contexts(app)).toEqual([
    { projectRoot: PROJECT, cwd: PROJECT, sessionId: here.id },
    { projectRoot: OTHER, cwd: OTHER, sessionId: '' },
  ]);
});

test('a kept shell whose folder is gone says so, in its screen and the header, and its icon fails', async ({ app, page }) => {
  await app.boot({ ...withKept(KEPT), paths: { [API]: 'missing' } });
  await expect.poll(() => starts(app)).toHaveLength(1);
  await expect(page.locator('.panel-end', { hasText: `${API} is not there` })).toBeVisible();
  await expect(railItem(page, /^Shell/).locator('.nudge.failed')).toBeVisible();
  await expect(panelTab(page, 'api')).toHaveClass(/\bcold\b/);
});
