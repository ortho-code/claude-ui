import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';

// The ways the session list starts a session other than a row's own click (docs/architecture.md § Tab lifecycle): a sibling from the siblings menu, a fork from a row's options, and a session in a new worktree from the project's "+".
const parent = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'The parent', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000a2'] });
const sibling = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Its sibling', isSibling: true, siblingIds: [parent.id], lastActivity: '2026-09-30T07:00:00.000Z' });
const fixture = {
  sessions: [parent, sibling],
  history: { [parent.id]: [], [sibling.id]: [] },
  groupState: { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }], groupOf: { [parent.id]: 'g-work' } },
};

/** Every claude the window started: the folder, and how. */
const launches = async (app: App): Promise<[string, TerminalLaunch][]> => (await app.calls('startTerminal')) as [string, TerminalLaunch][];

test("the siblings menu goes to a sibling: its tab opens, resumed, on show", async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('.session', { hasText: parent.title }).locator('.sibling-badge').click();
  await page.locator('.kebab-menu button', { hasText: sibling.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = await launches(app);
  expect(launch.resumeSessionId).toBe(sibling.id);
  await expect(page.locator('.tab', { hasText: sibling.title })).toHaveClass(/\bactive\b/);
});

test("a fork from a row's options starts a copy of it under a new id, named as asked, in its parent's group", async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('.session', { hasText: parent.title }).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Fork this session' }).click();
  await expect(page.locator('#rename-input')).toHaveValue(parent.title);
  await page.locator('#rename-input').fill('The fork');
  await page.locator('#rename-ok').click();

  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd, launch]] = await launches(app);
  expect(cwd).toBe(PROJECT);
  expect(launch).toMatchObject({ resumeSessionId: parent.id, fork: true, name: 'The fork' });
  expect(launch.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(launch.sessionId).not.toBe(parent.id);
  expect(await app.calls('moveSessionToGroup')).toEqual([[launch.sessionId, 'g-work']]);
  await expect(page.locator('.tab', { hasText: 'The fork' })).toHaveClass(/\bactive\b/);
  const group = page.locator('#sessions .group', { has: page.locator('> .section-heading .label', { hasText: /^Work$/ }) });
  await expect(group.locator('.card-title', { hasText: 'The fork' })).toHaveCount(1);
});

test("a new worktree session from the project's \"+\" starts claude in a fresh worktree, named by claude when left blank", async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#sessions .project .project-add-caret').click();
  await page.locator('.kebab-menu button', { hasText: 'New worktree session…' }).click();
  await expect(page.locator('#rename-overlay')).toBeVisible();
  await page.locator('#rename-ok').click();

  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd, launch]] = await launches(app);
  expect(cwd).toBe(PROJECT);
  expect(launch.worktree).toBe('');
  expect(launch.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(launch.resumeSessionId).toBeUndefined();
  await expect(page.locator('#tabbar .tab.active')).toHaveCount(1);
});
