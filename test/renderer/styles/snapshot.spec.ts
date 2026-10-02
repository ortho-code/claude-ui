import type { Page } from '@playwright/test';
import { defaultUi } from '../../../src/shared/defaults';
import type { Exchange, UiState } from '../../../src/shared/types';
import { LAYOUT, runs, withLayout } from '../panels/layout/layout';
import { type BridgeFixture, CONFIG_ROOT, HOME, PROJECT, session } from '../support/fixture';
import { type App, expect, test } from '../support/harness';
import { row, rows, tabLabel } from '../support/window';
import { snapshot } from './capture';

// NOT A CHECK: a tool, for moving CSS without changing what anything looks like (docs/architecture.md § The window's checks).
// Skipped unless STYLE_SNAPSHOT names a folder; then each test below puts the window in one state and writes its computed styles there, one file per state.
// Capture before a change and after it, and compare the two folders, with a map of the classes the change renames if it renames any (compare.ts):
//   STYLE_SNAPSHOT=/tmp/styles-before npm run test:renderer -- styles
//   STYLE_SNAPSHOT=/tmp/styles-after npm run test:renderer -- styles
//   npm run styles:compare -- /tmp/styles-before /tmp/styles-after [renames.json]
// A state a change needs and this lacks is added here first, in a commit of its own, so the capture before the change has it too.
const DIR = process.env.STYLE_SNAPSHOT;
test.skip(!DIR, "Set STYLE_SNAPSHOT to a folder to write the window's computed styles into.");
// Each state is its own page and its own file, so they run side by side.
test.describe.configure({ mode: 'parallel' });
// A fixed clock, so no "3 days ago" grows a character between two captures; and more time than a check gets, since a capture reads every control twice.
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00.000Z'));
});

const OTHER = `${HOME}/projects/other`;
const GONE = `${HOME}/projects/gone`;
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cold = session({ id: id(1), title: 'Cold in Alpha' });
const live = session({ id: id(2), title: 'Live and busy in Alpha' });
const booting = session({ id: id(3), title: 'Booting' });
const marked = session({ id: id(4), title: 'Pinned, noted, a worktree', worktree: 'feature-x', isSibling: true, siblingIds: [id(5)] });
const sibling = session({ id: id(5), title: 'A sibling', isSibling: true, siblingIds: [id(4)] });
const there = session({ id: id(6), title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const dead = session({ id: id(7), title: 'In a folder that is gone', cwd: GONE, repoRoot: GONE, cwdExists: false, repoRootExists: false });
const folded = session({ id: id(8), title: 'In a folded group' });
const everyone = [cold, live, booting, marked, sibling, there, dead, folded];
const groups = {
  groups: [
    { id: 'g-alpha', name: 'Alpha', repoRoot: PROJECT },
    { id: 'g-beta', name: 'Beta', repoRoot: PROJECT },
  ],
  groupOf: { [cold.id]: 'g-alpha', [live.id]: 'g-alpha', [folded.id]: 'g-beta' },
};
const busy = {
  sessions: everyone,
  projectOrder: [PROJECT, OTHER, GONE],
  activeProject: null,
  pinned: [marked.id],
  notes: { [marked.id]: 'A note\non two lines' },
  openSessions: [cold.id, live.id, booting.id, there.id, dead.id],
  groupState: groups,
  statuses: { [cold.id]: 'waiting', [live.id]: 'busy', [there.id]: 'idle' },
  history: Object.fromEntries(everyone.map((s) => [s.id, []])),
};
const ui = (over: Partial<UiState>): { uiState: UiState } => ({ uiState: { ...defaultUi(), ...over } });

/** Start the tab of `title` and, unless it is to stay booting, let its claude print. */
async function start(app: App, page: Page, title: string, pty: number, print = true): Promise<void> {
  await tabLabel(page, title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(pty);
  if (print) expect(await app.emit('onTerminalData', pty, `${title}\r\n`)).toBe(1);
}

test('first run', async ({ app, page }) => {
  await app.boot();
  await expect(rows(page)).toHaveCount(1);
  await snapshot(page, DIR!, 'first-run');
});

test('a busy window: groups, marks, tabs in every state, the strip and both toasts', async ({ app, page }) => {
  await app.boot({ ...busy, ...ui({ collapsedGroups: ['g-beta'] }) });
  await start(app, page, live.title, 1);
  await start(app, page, there.title, 2);
  await start(app, page, booting.title, 3, false);
  // A waiting dot marked read, a background tab turning to wait for you (the attention toast), and the toast that stays until dismissed.
  await row(page, cold.title).locator('.nudge').click();
  await app.emit('onSessionStatus', there.id, 'waiting', '');
  await app.emit('onClaudeMissing');
  await expect(page.locator('#notifications .notif')).toHaveCount(1);
  // Held as a pointer resting on it holds it, or it goes after five seconds, in the middle of the capture.
  await page.locator('#notifications .notif').dispatchEvent('mouseenter');
  await expect(page.locator('#toast')).toBeVisible();
  await snapshot(page, DIR!, 'busy');
});

test('the filter panel open, with a search, a pill and the calendar', async ({ app, page }) => {
  const from = Date.parse('2026-09-01T00:00:00.000Z');
  const to = Date.parse('2026-09-30T23:59:59.999Z');
  await app.boot({ ...busy, openSessions: [], ...ui({ search: 'a', filters: { ...defaultUi().filters, pinned: true }, datePreset: 'custom', dateFrom: from, dateTo: to, filterPanelOpen: true }) });
  await page.locator('#date-range-label').click();
  await expect(page.locator('#date-custom')).toBeVisible();
  // Off the button the click left it resting on, whose rounded corner otherwise came out a shade different from one capture to the next.
  await page.mouse.move(0, 0);
  await snapshot(page, DIR!, 'filter-open');
});

test('the filter panel shut over a filter, as chips', async ({ app, page }) => {
  await app.boot({ ...busy, openSessions: [], ...ui({ search: 'a', filters: { ...defaultUi().filters, pinned: true }, datePreset: '7d', filterPanelOpen: false }) });
  await expect(page.locator('#filter-chips .filter-chip')).toHaveCount(3);
  await snapshot(page, DIR!, 'filter-shut');
});

test("a session's menu with its submenu open", async ({ app, page }) => {
  await app.boot({ ...busy, openSessions: [] });
  await row(page, marked.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Move to group' }).click();
  await expect(page.locator('.kebab-menu.submenu')).toBeVisible();
  await snapshot(page, DIR!, 'menu');
});

test('the menu of a session whose folder is gone, its fork there but unavailable', async ({ app, page }) => {
  await app.boot({ ...busy, openSessions: [] });
  await row(page, dead.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button.unavailable', { hasText: 'Fork this session' })).toBeVisible();
  await snapshot(page, DIR!, 'menu-unavailable');
});

test('a tooltip up, over the filter toggle', async ({ app, page }) => {
  await app.boot({ ...busy, openSessions: [] });
  await page.locator('#filter-toggle').hover();
  await expect(page.locator('#tooltip')).toBeVisible();
  await snapshot(page, DIR!, 'tooltip');
});

test('the project switcher open', async ({ app, page }) => {
  await app.boot({ ...busy, openSessions: [] });
  await page.locator('#switcher-current').click();
  await expect(page.locator('#switcher-popover')).toBeVisible();
  await snapshot(page, DIR!, 'switcher');
});

test("the window's own title bar and resize edges, where the app draws its chrome", async ({ app, page }) => {
  await app.boot({ windowChrome: { own: true, maximized: false, title: 'Claude UI (test)', version: '0.0.0-test', dev: true } });
  await expect(page.locator('#titlebar')).toBeVisible();
  // A box of no size of its own, since every handle in it is fixed to the window, so it is shown rather than visible.
  await expect(page.locator('#resize-edges')).not.toHaveAttribute('hidden');
  await snapshot(page, DIR!, 'chrome');
});

test('Settings open', async ({ app, page }) => {
  await app.boot();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#settings-overlay')).toBeVisible();
  await snapshot(page, DIR!, 'settings');
});

test('the text prompt open, renaming a project', async ({ app, page }) => {
  await app.boot();
  await page.locator('.project-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Rename…' }).click();
  await expect(page.locator('#rename-overlay')).toBeVisible();
  await snapshot(page, DIR!, 'prompt');
});

test('the confirm dialog open, deleting an archived session', async ({ app, page }) => {
  const one = session();
  await app.boot({ archived: { [one.id]: Date.parse('2026-09-29T12:00:00.000Z') }, ...ui({ filters: { ...defaultUi().filters, archived: true } }) });
  await page.locator('.session .delete-btn').click();
  await expect(page.locator('#confirm-overlay')).toBeVisible();
  await snapshot(page, DIR!, 'confirm');
});

test('the history open over a live claude, with pins, code and a folded run of tools', async ({ app, page }) => {
  const one = session();
  const TIME = '2026-09-30T08:00:00.000Z';
  const exchanges: Exchange[] = [
    {
      id: 'request-1',
      time: TIME,
      request: 'Look at the parser',
      kind: 'typed',
      replaced: false,
      rewound: false,
      parts: [
        { kind: 'text', id: 'message-1', time: TIME, text: 'Reading it now, starting with `parse()`.' },
        { kind: 'tool', name: 'Read', detail: 'src/parser.ts' },
        { kind: 'tool', name: 'Bash', detail: 'npm test' },
        { kind: 'text', id: 'message-2', time: TIME, text: 'Found it:\n\n```ts\nconst x = 1;\n```\n\n> quoted' },
      ],
    },
    { id: 'request-2', time: TIME, request: 'Sent again', kind: 'typed', replaced: true, rewound: false, parts: [] },
    { id: 'request-3', time: TIME, request: 'The last request', kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'text', id: 'message-3', time: TIME, text: 'Done.' }] },
  ];
  const pinned = { kind: 'reply' as const, session: one.id, text: 'Found it', time: TIME, pinnedAt: 0 };
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: exchanges }, historyPins: { 'message-2': pinned, 'request-1': { ...pinned, kind: 'request', text: 'Look at the parser' } } });
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await app.emit('onTerminalData', 1, 'Claude Code\r\n');
  await expect(page.locator('.exchange')).toHaveCount(3);
  await page.getByRole('button', { name: /^Your last request/ }).click();
  await page.mouse.move(0, 0);
  await expect(page.locator('.history')).toHaveClass(/\bshown\b/);
  await snapshot(page, DIR!, 'history');
});

/** A tab restored where you left off: on show, cold, with a history to read. */
const restored = (): Partial<BridgeFixture> => {
  const one = session();
  const exchange: Exchange = { id: 'request-1', time: '2026-09-30T08:00:00.000Z', request: 'Look at the parser', kind: 'typed', replaced: false, rewound: false, parts: [] };
  return { openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange] } };
};

test("a cold tab on show, with the pane's two ways on", async ({ app, page }) => {
  await app.boot(restored());
  await expect(page.locator('.pane-actions button')).toHaveCount(2);
  await snapshot(page, DIR!, 'cold-tab');
});

test('the history standing in for a cold tab, under its sentence', async ({ app, page }) => {
  await app.boot(restored());
  await page.getByRole('button', { name: 'Show history' }).click();
  await page.mouse.move(0, 0);
  await expect(page.locator('.history')).toHaveClass(/\bstandalone\b/);
  await expect(page.locator('.exchange')).toHaveCount(1);
  await snapshot(page, DIR!, 'history-standing');
});

test('panels: a railed group with output, a shell in a drawer, and a panel that cannot run', async ({ app, page }) => {
  const layout = structuredClone(LAYOUT);
  const right = layout.root.columns[2] as { panels: object[] };
  right.panels.push({ id: 'broken', type: 'no-such-type' });
  await app.boot(withLayout(layout));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  const { token } = (await runs(app, 'status'))[0];
  await app.emit('onPanelRun', 'status', token, { kind: 'output', text: ' M src/parser.ts\n?? notes.md\n' });
  await app.emit('onPanelRun', 'status', token, { kind: 'exit', code: 0, signal: null });
  await expect(page.locator('.panel-rail .rail-item')).toHaveCount(3);
  await snapshot(page, DIR!, 'panels');
});

// A list panel, a type of the config folder's own: rows in every tone, with and without a link, one that started a session, a section folded and one empty, the count and a note.
const QUEUE_DIR = `${CONFIG_ROOT}/types/reviews`;
const reviewed = session({ id: id(20), title: 'Review #1' });
const queue = {
  ...withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'queue', type: 'reviews' }] },
      ],
    },
  }),
  sessions: [session(), reviewed],
  statuses: { [reviewed.id]: 'waiting' },
  paths: { [`${QUEUE_DIR}/list.sh`]: 'executable' as const },
  panelData: { queue: { sessions: { [reviewed.id]: { key: 'org/repo#1', label: 'Fix the login redirect', href: 'https://example.com/pr/1', startedAt: '2026-09-30T09:00:00.000Z' } }, lastGroup: {} } },
};
const LIST = {
  version: 1,
  badge: 2,
  sections: [
    {
      empty: 'Nothing waiting on you.',
      items: [
        { key: 'org/repo#1', text: 'Fix the login redirect', detail: '#1 · 3d · someone', href: 'https://example.com/pr/1', tone: 'attention', actions: [{ label: 'Review', session: { prompt: '/review 1', name: 'Review #1' } }] },
        { key: 'org/repo#2', text: 'Failing everywhere', detail: '#2 · 1d', tone: 'danger' },
        { key: 'org/repo#3', text: 'Parked for now', detail: '#3', href: 'https://example.com/pr/3', tone: 'muted' },
      ],
    },
    { title: 'Blocked', empty: 'Nothing blocked.', items: [] },
    { title: 'Done', shut: true, items: [{ key: 'org/repo#4', text: 'Merged', href: 'https://example.com/pr/4' }] },
  ],
  notes: ['Could not read team membership.'],
};

/** Boot with the queue panel and let its script print the list. */
async function bootQueue(app: App, page: Page): Promise<void> {
  await app.boot({ ...queue, layout: { ...queue.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' } }] } });
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  const { token } = (await runs(app, 'queue'))[0];
  await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: JSON.stringify(LIST) });
  await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code: 0, signal: null });
  await expect(page.locator('.list-row')).toHaveCount(3);
}

test('a list panel: tones, links, a linked session, folded and empty sections, the count and a note', async ({ app, page }) => {
  await bootQueue(app, page);
  await snapshot(page, DIR!, 'list');
});

test("the session dialog a list row opens, offering to continue the row's session", async ({ app, page }) => {
  await bootQueue(app, page);
  await page.locator('.list-row .list-action', { hasText: 'Review' }).click();
  await expect(page.locator('#session-overlay')).toBeVisible();
  await expect(page.locator('#session-mode')).toBeVisible();
  await snapshot(page, DIR!, 'session-dialog');
});
