import type { Locator, Page } from '@playwright/test';
import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { bootDiff, file, menuRows, rows, summary } from './explorer';

// The path over the Explorer's list says where its topmost row in view sits, its checkout and the folders that hold it, cut in the middle when it does not fit, each part a press away.

/** Files enough under one deep folder that the list scrolls well past it, then a few at the top of the checkout. */
const deep = 'src/app/http';
const many = summary({ files: [...Array.from({ length: 40 }, (_, n) => file(`${deep}/Controller${String(n).padStart(2, '0')}.php`)), file('README.md')] });
const path = (page: Page): Locator => page.locator('.explorer-path');

/** Scroll the list so the row naming `text` is the first in view. */
async function scrollTo(page: Page, text: string): Promise<void> {
  await rows(page).filter({ hasText: text }).first().evaluate((row) => {
    const list = row.closest<HTMLElement>('.explorer-files')!;
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top + 2;
  });
}

const tree = (page: Page): Promise<void> => page.locator('.panel-header .panel-view').nth(1).click();

test('out of sight while the checkout’s own row is the top one, again once scrolled back to it', async ({ app, page }) => {
  await bootDiff(app, { since: many });
  await tree(page);
  await expect(path(page)).toBeHidden();
  await scrollTo(page, 'Controller20.php');
  await expect(path(page)).toBeVisible();
  await page.locator('.explorer-files').evaluate((list) => (list.scrollTop = 0));
  await expect(path(page)).toBeHidden();
});

test('in the tree, it names the checkout and the folders holding the topmost row in view', async ({ app, page }) => {
  await bootDiff(app, { since: many });
  await tree(page);
  await scrollTo(page, 'Controller20.php');
  await expect(path(page)).toHaveText('demo›src/app/http');
});

test('in the flat list, whose rows name their folders, it names the checkout alone', async ({ app, page }) => {
  await bootDiff(app, { since: many });
  await scrollTo(page, 'Controller20.php');
  await expect(path(page)).toHaveText('demo');
});

test('wider than the line, it gives up folders from the checkout’s side into one …, keeping the checkout and the nearest folder', async ({ app, page }) => {
  const long = 'a-folder-with-a-rather-long-name/another-folder-with-a-long-name/yet-another-long-folder/http';
  await bootDiff(app, { since: summary({ files: Array.from({ length: 40 }, (_, n) => file(`${long}/File${n}.php`)) }) });
  await tree(page);
  await scrollTo(page, 'File20.php');
  await expect(path(page)).toContainText('…');
  const text = await path(page).textContent();
  expect(text?.startsWith('demo›')).toBe(true);
  expect(text?.endsWith('/http')).toBe(true);
  expect(await path(page).evaluate((line) => line.scrollWidth <= line.clientWidth)).toBe(true);
});

test('a checkout’s long name takes at most 40% of the line while folders follow it, so the folders keep their room', async ({ app, page }) => {
  const name = 'sync-composer-locks-also-updates-what-a-changed-library-needs';
  const root = `${PROJECT}/.claude/worktrees/${name}`;
  const files = Array.from({ length: 40 }, (_, n) => file(`lib/bus/File${n}.php`));
  await bootDiff(app, {}, {
    as: { cwd: root, worktree: name, checkouts: [{ root, at: '2026-11-19T08:00:00.000Z', gone: false, own: true }] },
    checkouts: { [root]: { diffs: { since: summary({ root, branch: name, files }) } } },
  });
  await tree(page);
  await scrollTo(page, 'File20.php');
  await expect(path(page)).toContainText('lib/bus');
  const [nameWidth, lineWidth] = await path(page).getByRole('button', { name }).evaluate((el) => [el.getBoundingClientRect().width, el.parentElement!.clientWidth]);
  expect(nameWidth).toBeLessThanOrEqual(lineWidth * 0.4 + 1);
});

test('with a checkout’s name too long to leave room, the name gives way, cut at its end, and the nearest folder stays whole', async ({ app, page }) => {
  const name = 'sync-composer-locks-also-updates-what-a-changed-library-needs';
  const root = `${PROJECT}/.claude/worktrees/${name}`;
  const files = Array.from({ length: 40 }, (_, n) => file(`packages/command-bus/File${n}.php`));
  await bootDiff(app, {}, {
    as: { cwd: root, worktree: name, checkouts: [{ root, at: '2026-11-19T08:00:00.000Z', gone: false, own: true }] },
    checkouts: { [root]: { diffs: { since: summary({ root, branch: name, files }) } } },
  });
  await tree(page);
  await scrollTo(page, 'File20.php');
  await expect(path(page)).toContainText('command-bus');
  const nearest = path(page).getByRole('button', { name: 'command-bus' });
  const fits = (el: HTMLElement): boolean => el.scrollWidth <= el.clientWidth;
  expect(await nearest.evaluate(fits)).toBe(true);
  expect(await nearest.evaluate((el) => el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right)).toBe(true);
  expect(await path(page).getByRole('button', { name }).evaluate(fits)).toBe(false);
});

test('the … is a press away from the folders it stands for, in a menu, each bringing its row to the top', async ({ app, page }) => {
  const long = 'a-folder-with-a-rather-long-name/another-folder-with-a-long-name/yet-another-long-folder/http';
  await bootDiff(app, { since: summary({ files: Array.from({ length: 40 }, (_, n) => file(`${long}/File${n}.php`)) }) });
  await tree(page);
  await scrollTo(page, 'File20.php');
  await path(page).getByRole('button', { name: '…' }).click();
  const items = menuRows(page);
  await expect(items.first()).toHaveText('a-folder-with-a-rather-long-name');
  await items.first().click();
  const top = await rows(page).filter({ hasText: /^a-folder-with-a-rather-long-name/ }).first().evaluate((row) => row.getBoundingClientRect().top - row.closest<HTMLElement>('.explorer-files')!.getBoundingClientRect().top);
  expect(Math.abs(top)).toBeLessThanOrEqual(1);
});

test('narrowed after it was drawn, it folds again to fit, and gives the folders back once there is room', async ({ app, page }) => {
  const long = 'a-long-folder/another/http';
  await bootDiff(app, { since: summary({ files: Array.from({ length: 40 }, (_, n) => file(`${long}/File${n}.php`)) }) });
  await tree(page);
  await scrollTo(page, 'File20.php');
  await expect(path(page)).toHaveText(`demo›${long}`);
  const width = page.viewportSize()!;
  await page.setViewportSize({ width: 520, height: width.height });
  await expect(path(page)).toContainText('…');
  await page.setViewportSize(width);
  await expect(path(page)).toHaveText(`demo›${long}`);
});

test('a part of the path takes the text’s own colour under the pointer, out of the line’s muted one', async ({ app, page }) => {
  await bootDiff(app, { since: many });
  await tree(page);
  await scrollTo(page, 'Controller20.php');
  const part = path(page).getByRole('button', { name: 'app' });
  const colour = (): Promise<string> => part.evaluate((el) => getComputedStyle(el).color);
  const muted = await colour();
  await part.hover();
  const text = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = 'var(--text)';
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(text).not.toBe(muted);
  await expect.poll(colour).toBe(text);
});

test('a press on a folder of the path brings that folder’s row to the top', async ({ app, page }) => {
  await bootDiff(app, { since: many });
  await tree(page);
  await scrollTo(page, 'Controller30.php');
  await path(page).getByRole('button', { name: 'app' }).click();
  const top = await rows(page).filter({ hasText: /^app/ }).first().evaluate((row) => row.getBoundingClientRect().top - row.closest<HTMLElement>('.explorer-files')!.getBoundingClientRect().top);
  expect(Math.abs(top)).toBeLessThanOrEqual(1);
  await expect(path(page)).toHaveText('demo›src');
});
