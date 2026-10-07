import type { Locator, Page } from '@playwright/test';
import type { PanelLink } from '../../../../../src/shared/panels';
import type { TerminalLaunch } from '../../../../../src/shared/types';
import { CONFIG_ROOT, PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { hoveredAndOpen } from '../../../support/looks';
import { clickAcross } from '../../../support/press';
import { row, tab, tabLabel } from '../../../support/window';
import { runs, withLayout } from '../../layout/layout';

// A list panel's row marks the sessions it started with the session list's own dot, in the list's own words (docs/architecture.md § Panels): it follows each session's status, a mark read, and whether it runs, as the session list does.
// The mark goes to its session, and a row's action starts one through the app's own dialog, which remembers it under the row.
const QUEUE_DIR = `${CONFIG_ROOT}/types/reviews`;
const reviewed = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'Review #1' });
const quiet = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Review #2' });
const link = (key: string): PanelLink => ({ key, label: key, href: null, startedAt: '2026-09-30T09:00:00.000Z' });
const fixture = {
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
  sessions: [reviewed, quiet],
  statuses: { [reviewed.id]: 'waiting' },
  openSessions: [quiet.id],
  history: { [reviewed.id]: [], [quiet.id]: [] },
  paths: { [`${QUEUE_DIR}/list.sh`]: 'executable' as const },
  panelData: { queue: { sessions: { [reviewed.id]: link('org/repo#1'), [quiet.id]: link('org/repo#2') }, lastGroup: {} } },
};
const LIST = {
  version: 1,
  sections: [
    {
      items: [
        { key: 'org/repo#1', text: 'Fix the login redirect' },
        { key: 'org/repo#2', text: 'Tidy the settings page' },
        { key: 'org/repo#3', text: 'Speed up the search', href: 'https://example.com/pr/3', actions: [{ label: 'Review', session: { prompt: '/review 3', name: 'Review #3' } }] },
      ],
    },
  ],
};

const mark = (page: Page, text: string): Locator => page.locator('.list-row', { hasText: text }).locator('.list-session');

/** What a lit card is filled with, read off the stylesheet's own token rather than written here. */
const litFill = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.background = 'var(--surface-hover)';
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return fill;
  });

/** Boot with the queue panel, its rows' sessions as given, and let its script print the list. */
async function bootQueue(app: App, page: Page, links: Record<string, PanelLink> = fixture.panelData.queue.sessions): Promise<void> {
  await app.boot({ ...fixture, panelData: { queue: { sessions: links, lastGroup: {} } }, layout: { ...fixture.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' } }] } });
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  const { token } = (await runs(app, 'queue'))[0];
  await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: JSON.stringify(LIST) });
  await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code: 0, signal: null });
  await expect(page.locator('.list-row')).toHaveCount(3);
}

test("a row's session mark goes to its session: its tab opens, resumed, on show", async ({ app, page }) => {
  await bootQueue(app, page);
  await mark(page, 'Fix the login redirect').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(reviewed.id);
  await expect(tab(page, reviewed.title)).toHaveClass(/\bactive\b/);
});

test("a row's action starts a session through the app's dialog, remembered under the row from the start", async ({ app, page }) => {
  await bootQueue(app, page);
  await page.locator('.list-row', { hasText: 'Speed up the search' }).locator('.list-action', { hasText: 'Review' }).click();
  await expect(page.locator('#session-overlay')).toBeVisible();
  await expect(page.locator('#session-name')).toHaveValue('Review #3');
  await expect(page.locator('#session-prompt')).toHaveValue('/review 3');
  await page.locator('#session-ok').click();

  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(cwd).toBe(PROJECT);
  expect(launch).toMatchObject({ name: 'Review #3', prompt: '/review 3' });
  const [[entry, id, linked, filed]] = (await app.calls('linkPanelSession')) as [string, string, object, object][];
  expect([entry, id, linked, filed]).toEqual(['queue', launch.sessionId, { key: 'org/repo#3', label: 'Speed up the search', href: 'https://example.com/pr/3' }, { repoRoot: PROJECT, groupId: null }]);
  await expect(tab(page, 'Review #3')).toHaveClass(/\bactive\b/);
  // The row leads back to it before claude has written anything.
  await expect(mark(page, 'Speed up the search')).toHaveAttribute('aria-label', 'Go to Review #3 · running');
});

test("a row's session mark follows its session's status, a mark read, and whether it runs", async ({ app, page }) => {
  await bootQueue(app, page);

  // Its status, as it changes.
  await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\bwaiting\b/);
  expect(await app.emit('onSessionStatus', reviewed.id, 'busy', '', 'UserPromptSubmit')).toBe(1);
  await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\bbusy\b/);

  // A mark read, made on the session list's own dot.
  expect(await app.emit('onSessionStatus', reviewed.id, 'idle', '', 'Stop')).toBe(1);
  await row(page, reviewed.title).locator('.nudge').click();
  await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\backed\b/);

  // Without a status, whether it runs: its tab started, and stopped again.
  await expect(mark(page, 'Tidy the settings page')).toHaveAttribute('aria-label', `Go to ${quiet.title} · not running`);
  await tabLabel(page, quiet.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(mark(page, 'Tidy the settings page')).toHaveAttribute('aria-label', `Go to ${quiet.title} · running`);
  await tab(page, quiet.title).locator('.tab-close').click();
  await app.emit('onTerminalExit', 1, 0);
  await expect(mark(page, 'Tidy the settings page')).toHaveAttribute('aria-label', `Go to ${quiet.title} · not running`);
});

test("a row's sessions are offered each with its own dot, as the row's mark and the session list draw it", async ({ app, page }) => {
  await bootQueue(app, page, { [reviewed.id]: link('org/repo#3'), [quiet.id]: link('org/repo#3') });
  const entryDot = (title: string): Locator => page.locator('.kebab-menu button', { hasText: title }).locator('.nudge');
  const listDot = (title: string): Locator => row(page, title).locator('.nudge');

  // Waiting, and nothing to report yet: pulsing, and a hollow ring.
  await mark(page, 'Speed up the search').click();
  await expect(entryDot(reviewed.title)).toHaveClass('nudge single waiting');
  await expect(entryDot(quiet.title)).toHaveClass('nudge single');

  // Read, on the session list's own dot: dimmed here too.
  await listDot(reviewed.title).click();
  await expect(listDot(reviewed.title)).toHaveClass(/\backed\b/);
  await mark(page, 'Speed up the search').click();
  await expect(entryDot(reviewed.title)).toHaveClass('nudge single waiting acked');
});

test('a row stays lit while the menu its session mark opened is up, as a session row does', async ({ app, page }) => {
  await bootQueue(app, page, { [reviewed.id]: link('org/repo#3'), [quiet.id]: link('org/repo#3') });
  const item = page.locator('.list-row', { hasText: 'Speed up the search' });
  await mark(page, 'Speed up the search').click();
  // On the menu, off the row, so the open menu is all that can be lighting it.
  await page.locator('.kebab-menu button', { hasText: reviewed.title }).hover();
  const lit = await litFill(page);
  await expect.poll(() => item.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(lit);
});

// The list is drawn again on every run that prints one, and a row's session mark whenever a session it started changes, which can land between a press and its release, or under a button reached with the keyboard: a row that stays where it is keeps both.
test('a press on a row, its mark, its action or a heading still counts, and a focused action keeps the focus, when the list is drawn again', async ({ app, page }) => {
  await bootQueue(app, page);
  const review = { label: 'Review', session: { prompt: '/review 3', name: 'Review #3' } };
  const merge = { label: 'Merge', session: { prompt: '/merge 3', name: 'Merge #3' } };
  // The list under a heading, its second row's detail saying which run printed it, so each run draws something new, and the third row offering `action`.
  const printed = (run: number, action: typeof review): unknown => ({
    ...LIST,
    sections: LIST.sections.map((section) => ({ ...section, title: 'Open', items: section.items.map((item, at) => (at === 1 ? { ...item, detail: `run ${run}` } : at === 2 ? { ...item, actions: [action] } : item)) })),
  });
  // A run asked for now, which prints the list and ends when what this returns is called.
  const rerun = async (run: number, action = review): Promise<() => Promise<void>> => {
    const before = (await runs(app, 'queue')).length;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(async () => (await runs(app, 'queue')).length).toBe(before + 1);
    const { token } = (await runs(app, 'queue')).at(-1)!;
    return async () => {
      await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: JSON.stringify(printed(run, action)) });
      await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code: 0, signal: null });
      await expect(page.locator('.list-row', { hasText: `run ${run}` })).toHaveCount(1);
    };
  };
  await (await rerun(0))();
  const action = page.locator('.list-row', { hasText: 'Speed up the search' }).locator('.list-action');

  // Asked for first, since pressing Refresh takes the focus.
  const ended = await rerun(1);
  await action.focus();
  await ended();
  await expect(action).toBeFocused();

  await clickAcross(page, page.locator('.list-row', { hasText: 'Speed up the search' }).locator('.card-title'), await rerun(2));
  expect(await app.calls('openExternal')).toEqual([['https://example.com/pr/3']]);

  // The mark's dot is its own element, over the middle of the mark, and it is drawn again when its session's status changes.
  await clickAcross(page, mark(page, 'Fix the login redirect'), async () => {
    expect(await app.emit('onSessionStatus', reviewed.id, 'busy', '', 'UserPromptSubmit')).toBe(1);
    await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\bbusy\b/);
  });
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);

  const heading = page.locator('.list-section .section-heading', { hasText: 'Open' });
  await clickAcross(page, heading.locator('.caret'), await rerun(3));
  await expect(page.locator('.list-row')).toHaveCount(0);
  await heading.click();
  await expect(page.locator('.list-row')).toHaveCount(3);

  // An action the run replaced under the pointer asks for nothing, rather than for the action now in its place.
  // Asking reads the panel's data in the press itself, before anything waits, so the reads say whether it asked.
  const reads = (await app.calls('getPanelData')).length;
  await clickAcross(page, action, await rerun(4, merge));
  await expect(action).toHaveText('Merge');
  expect(await app.calls('getPanelData')).toHaveLength(reads);

  await clickAcross(page, action, await rerun(5, merge));
  await expect(page.locator('#session-overlay')).toBeVisible();
  await expect(page.locator('#session-prompt')).toHaveValue('/merge 3');
});

test("a still row's session mark keeps its hover look while its menu is up, which is all that says where the menu came from", async ({ app, page }) => {
  await bootQueue(app, page, { [reviewed.id]: link('org/repo#1'), [quiet.id]: link('org/repo#1') });
  await expect(page.locator('.list-row', { hasText: 'Fix the login redirect' })).toHaveClass(/\bstill\b/);
  const { hovered, open } = await hoveredAndOpen(page, mark(page, 'Fix the login redirect'));
  expect(open).toEqual(hovered);
});
