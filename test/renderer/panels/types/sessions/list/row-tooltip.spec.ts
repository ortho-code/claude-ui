import type { PrStatus } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// A session row's tooltip says everything the row shows, wherever on the row you hover, and a button or mark with a tooltip of its own keeps it (decided 2026-11-12).
const MINUTE = 60_000;
const one = session();
const ACTIVE = Date.parse(one.lastActivity);

test("a row's tooltip is on the row, its name, its line and when it was last active, and its title and time carry none of their own", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  await app.boot({ sessions: [one] });
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', `${one.title}\n5 min ago · Opus 5.5\nLast active: wo 30 sep, 10:00`);
  await expect(row(page, one.title).locator('.card-title')).not.toHaveAttribute('data-tooltip');
  await expect(row(page, one.title).locator('.meta-text')).not.toHaveAttribute('data-tooltip');

  await page.clock.fastForward('01:00:00');
  await expect(row(page, one.title)).toHaveAttribute('data-tooltip', `${one.title}\n1 h ago · Opus 5.5\nLast active: wo 30 sep, 10:00`);
});

test("a row's tooltip says its state, its PRs with their dates and its whole note, and its marks keep their own", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  const linked = session({ ...one, prs: [{ repository: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7' }] });
  const merged: PrStatus = { state: 'merged', role: 'own', title: 'Ship it', settledAt: '2026-09-29T12:02:00Z' };
  await app.boot({ sessions: [linked], statuses: { [linked.id]: 'ready' }, notes: { [linked.id]: 'Waiting for the release\nthen finish' }, prStatuses: { 'acme/app#7': merged } });
  await expect(row(page, linked.title)).toHaveAttribute(
    'data-tooltip',
    [linked.title, '5 min ago · Opus 5.5', 'Ready', 'Last active: wo 30 sep, 10:00', '#7 · Ship it — acme/app · merged di 29 sep, 14:02', 'Note: Waiting for the release\nthen finish'].join('\n'),
  );
  await expect(row(page, linked.title).locator('.pr-badge')).toHaveAttribute('data-tooltip', /^1 PR linked to this session/);
  await expect(row(page, linked.title).locator('.pin')).toHaveAttribute('data-tooltip', 'Pin');
});

test("a session that cannot start says why on its row's tooltip, under its name", async ({ app, page }) => {
  const gone = session({ title: 'Gone', cwdExists: false, repoRootExists: false });
  await app.boot({ sessions: [gone] });
  const lines = (await row(page, gone.title).getAttribute('data-tooltip'))!.split('\n');
  expect(lines[0]).toBe('Gone');
  expect(lines[1]).toMatch(/folder/i);
});

test("a stop claude has not left puts its words in the row's tooltip in place of the line they hide, until claude leaves", async ({ app, page }) => {
  await page.clock.install({ time: ACTIVE + 5 * MINUTE });
  await app.boot({ sessions: [one], history: { [one.id]: [] } });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', 1, 'claude is here')).toBe(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Stop session$/ }).click();
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  const line = async (): Promise<string | undefined> => (await row(page, one.title).getAttribute('data-tooltip'))?.split('\n')[1];
  const before = await line();
  expect(before).not.toBe("hasn't left");

  await page.clock.runFor(3000);
  await expect(row(page, one.title).locator('.not-left')).toHaveText("hasn't left");
  await expect.poll(line).toBe("hasn't left");

  await app.emit('onTerminalExit', 1, 0);
  await expect(row(page, one.title).locator('.not-left')).toBeHidden();
  await expect.poll(line).toBe(before);
});
