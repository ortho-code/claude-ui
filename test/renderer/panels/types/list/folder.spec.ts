import type { Locator, Page } from '@playwright/test';
import { CONFIG_ROOT, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { layoutWith } from './list';

// A list panel names the folder it looks in beside its title, as a command panel does, from the same rule (panels/run.ts, `folderOf`): it is the Changes panel this is for.

const WORKTREE = `${PROJECT}/.claude/worktrees/fix`;
const SCRIPT = `${CONFIG_ROOT}/panel-types/changes/list.mjs`;

/** A session working in the worktree, open and on show, its history empty, as a tab on show reads it. */
const working = session({ workCwd: WORKTREE });
const onShow = { sessions: [working], openSessions: [working.id], activeSession: working.id, history: { [working.id]: [] }, panelData: { changes: { sessions: {}, lastGroup: {} } } };

const mark = (page: Page): Locator => page.locator('.panel-header .panel-folder');

test('a list panel names the worktree its tab’s session works in', async ({ app, page }) => {
  await app.boot({ ...layoutWith(), ...onShow, paths: { [SCRIPT]: 'executable' } });
  await expect.poll(async () => (await runs(app, 'changes')).map(({ context }) => context.cwd)).toEqual([WORKTREE]);
  await expect(mark(page)).toHaveText('fix');
  await expect(mark(page)).toHaveAttribute('data-tooltip', WORKTREE);
});

test('a list panel that cannot run names no folder', async ({ app, page }) => {
  await app.boot({ ...layoutWith(), ...onShow, paths: { [SCRIPT]: 'missing' } });
  await expect(page.locator('.panel-problems', { hasText: 'run list.mjs not found' })).toBeVisible();
  await expect(mark(page)).toBeHidden();
});
