import type { Locator, Page } from '@playwright/test';
import type { PanelLink } from '../../../../../src/shared/panels';
import type { TerminalLaunch } from '../../../../../src/shared/types';
import { CONFIG_ROOT, PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
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

/** Boot with the queue panel and let its script print the list. */
async function bootQueue(app: App, page: Page): Promise<void> {
  await app.boot({ ...fixture, layout: { ...fixture.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' } }] } });
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
  await expect(page.locator('.tab', { hasText: reviewed.title })).toHaveClass(/\bactive\b/);
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
  await expect(page.locator('.tab', { hasText: 'Review #3' })).toHaveClass(/\bactive\b/);
  // The row leads back to it before claude has written anything.
  await expect(mark(page, 'Speed up the search')).toHaveAttribute('aria-label', 'Go to Review #3 · running');
});

test("a row's session mark follows its session's status, a mark read, and whether it runs", async ({ app, page }) => {
  await bootQueue(app, page);

  // Its status, as it changes.
  await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\bwaiting\b/);
  expect(await app.emit('onSessionStatus', reviewed.id, 'busy', '')).toBe(1);
  await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\bbusy\b/);

  // A mark read, made on the session list's own dot.
  expect(await app.emit('onSessionStatus', reviewed.id, 'idle', '')).toBe(1);
  await page.locator('.session', { hasText: reviewed.title }).locator('.nudge').click();
  await expect(mark(page, 'Fix the login redirect').locator('.nudge')).toHaveClass(/\backed\b/);

  // Without a status, whether it runs: its tab started, and stopped again.
  await expect(mark(page, 'Tidy the settings page')).toHaveAttribute('aria-label', `Go to ${quiet.title} · not running`);
  await page.locator('.tab-label', { hasText: quiet.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(mark(page, 'Tidy the settings page')).toHaveAttribute('aria-label', `Go to ${quiet.title} · running`);
  await page.locator('.tab', { hasText: quiet.title }).locator('.tab-close').click();
  await app.emit('onTerminalExit', 1, 0);
  await expect(mark(page, 'Tidy the settings page')).toHaveAttribute('aria-label', `Go to ${quiet.title} · not running`);
});
