import type { Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';

// The strip lists what is RUNNING, in tab order: projects in the order you set, and within one its loose tabs and then its groups in registry order, which is the tab bar's own order (`orderAsTabs`, one implementation for both).
// It keeps still: a session writing a message or waiting moves no row, which recency- or attention-ordering did (6f04c95).
const OTHER = `${HOME}/projects/other`;
const loose = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Loose in demo' });
const inFirst = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'In First' });
const inSecond = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'In Second' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000e4', title: 'In other', cwd: OTHER, repoRoot: OTHER });
const all = [loose, inFirst, inSecond, elsewhere];

/** The strip as it reads: each project's name, then its rows. */
const strip = (page: Page): Promise<string[]> =>
  page.locator('#footer-list > .footer-project, #footer-list > .footer-item .footer-item-name').allTextContents();

test('the attention strip lists running sessions in the order you set, and keeps still while they work', async ({ app, page }) => {
  await app.boot({
    sessions: all,
    projectOrder: [PROJECT, OTHER],
    activeProject: null,
    // Opened other-project first, and the later group before the earlier one, as in the tab bar's check.
    openSessions: [elsewhere.id, inFirst.id, inSecond.id, loose.id],
    groupState: {
      groups: [
        { id: 'g-second', name: 'Second', repoRoot: PROJECT },
        { id: 'g-first', name: 'First', repoRoot: PROJECT },
      ],
      groupOf: { [inFirst.id]: 'g-first', [inSecond.id]: 'g-second' },
    },
    // A tab on show has its history read; what it holds is not what is checked here.
    history: Object.fromEntries(all.map((s) => [s.id, []])),
  });
  await expect(page.locator('#sidebar-footer')).toBeHidden();

  // Running is what puts a session in the strip, so start every tab, in the order they were opened.
  for (const s of [elsewhere, inFirst, inSecond, loose]) await page.locator('.tab-label', { hasText: s.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(4);

  const expected = ['demo', loose.title, inSecond.title, inFirst.title, 'other', elsewhere.title];
  await expect.poll(() => strip(page)).toEqual(expected);

  // Work arriving in any order moves nothing.
  for (const [s, status] of [[inFirst, 'busy'], [elsewhere, 'waiting'], [loose, 'idle'], [inFirst, 'waiting']] as const) {
    expect(await app.emit('onSessionStatus', s.id, status, '')).toBe(1);
  }
  await expect(page.locator('#footer-label')).toHaveText('3 of 4 need you');
  expect(await strip(page)).toEqual(expected);
});
