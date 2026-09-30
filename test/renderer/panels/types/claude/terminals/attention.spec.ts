import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// A tab you are not looking at that turns waiting or finished says so in a toast, naming it and its project; a click on the toast takes you there (docs/architecture.md § Status cues).
// Never for busy, a repeat of the same state, or the tab on show.
const OTHER = `${HOME}/projects/other`;
const here = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Over here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const fixture = {
  sessions: [here, there],
  projectOrder: [PROJECT, OTHER],
  activeProject: PROJECT,
  openSessions: [here.id, there.id],
  activeSession: here.id,
  history: { [here.id]: [], [there.id]: [] },
};

const toasts = (page: Page): Locator => page.locator('#notifications .notif');

test('a status read at launch is not news: a restored tab already waiting is not toasted', async ({ app, page }) => {
  await app.boot({ ...fixture, statuses: { [there.id]: 'waiting' } });
  await expect(page.locator('.tab', { hasText: here.title })).toHaveClass(/\bactive\b/);
  // Read, and drawn: its project's entry in the switcher says it is waiting.
  await expect(page.locator('.switcher-item', { has: page.locator('.switcher-item-name', { hasText: /^other$/ }) }).locator('.nudge')).toHaveClass(/\bwaiting\b/);
  await expect(toasts(page)).toHaveCount(0);
});

test('a tab not on show that turns waiting or finished is toasted once, and the toast takes you to it', async ({ app, page }) => {
  await app.boot(fixture);
  const status = async (id: string, state: string): Promise<void> => {
    expect(await app.emit('onSessionStatus', id, state, '')).toBe(1);
  };
  await expect(page.locator('.tab', { hasText: here.title })).toHaveClass(/\bactive\b/);

  await status(there.id, 'busy');
  await expect(toasts(page)).toHaveCount(0);
  await status(there.id, 'waiting');
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page).first()).toHaveClass(/\bwaiting\b/);
  await expect(toasts(page).first().locator('.notif-title')).toHaveText(there.title);
  await expect(toasts(page).first().locator('.notif-proj')).toHaveText('other');

  // The same state again is no news, and the tab on show is already in front of you.
  await status(there.id, 'waiting');
  await status(here.id, 'idle');
  await expect(toasts(page)).toHaveCount(1);

  // Into its project, and onto its tab.
  await toasts(page).first().click();
  await expect(toasts(page)).toHaveCount(0);
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(page.locator('.tab', { hasText: there.title })).toHaveClass(/\bactive\b/);

  // Now the other one is behind you, and finishing is news.
  await status(here.id, 'busy');
  await status(here.id, 'idle');
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page).first()).toHaveClass(/\bidle\b/);
  await expect(toasts(page).first().locator('.notif-title')).toHaveText(here.title);
});
