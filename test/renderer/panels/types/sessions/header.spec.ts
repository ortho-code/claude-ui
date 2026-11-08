import { expect, test } from '../../../support/harness';
import { lookOf, token } from '../../../support/looks';

// The sidebar's header buttons, and the filter and collapse-all on the row under them, stand as peers, so they hover alike, to `--surface-hover`, and the ones that open something show it in `--active`, a stronger step than their hover: the ladder a live tab and the switcher's title climb too (docs/architecture/ui-conventions.md § UI conventions).

test('every header button, and the filter and collapse-all under them, hovers to the same fill and outline', async ({ app, page }) => {
  // All, so collapse has a project to fold and is not disabled.
  await app.boot({ activeProject: null });
  await expect(page.locator('#collapse-toggle')).toBeEnabled();
  const hover = { background: await token(page, '--surface-hover'), border: await token(page, '--accent'), color: await token(page, '--text') };
  for (const id of ['#settings-toggle', '#collapse-toggle', '#filter-toggle', '#new-session']) {
    const button = page.locator(id);
    await button.hover();
    expect(await lookOf(button), id).toEqual(hover);
  }
});

test('the row under the header holds its switch, Review, the filter and collapse-all inside a 320px sidebar', async ({ app, page }) => {
  await app.boot();
  const row = page.locator('#list-row');
  await expect(row.locator('#filter-toggle')).toBeVisible();
  await expect(row.locator('#collapse-toggle')).toBeVisible();
  const fit = await row.evaluate((box) => {
    const edge = box.getBoundingClientRect().right - parseFloat(getComputedStyle(box).paddingRight);
    return { sidebar: document.getElementById('sidebar')!.getBoundingClientRect().width, overflow: box.scrollWidth - box.clientWidth, last: [...box.querySelectorAll('button')].map((b) => b.getBoundingClientRect().right).reduce((a, b) => Math.max(a, b), 0), edge };
  });
  expect(fit.sidebar).toBe(320);
  expect(fit.overflow).toBe(0);
  expect(fit.last).toBeLessThanOrEqual(fit.edge + 0.5);
});

test('the settings button shows its dialog open in `--active`, and lets it go once the dialog shuts', async ({ app, page }) => {
  await app.boot();
  const settings = page.locator('#settings-toggle');
  const resting = await lookOf(settings);
  await settings.click();
  await expect(page.locator('#settings-overlay')).toBeVisible();
  expect(await lookOf(settings)).toEqual({ background: await token(page, '--active'), border: await token(page, '--accent'), color: await token(page, '--text') });
  await page.locator('#settings-cancel').click();
  await expect(page.locator('#settings-overlay')).toBeHidden();
  await page.mouse.move(0, 0);
  expect(await lookOf(settings)).toEqual(resting);
});

test('the filter button shows its panel open in a fill of its own, not its hover, under the pointer too', async ({ app, page }) => {
  await app.boot();
  const filter = page.locator('#filter-toggle');
  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  const open = { background: await token(page, '--active'), border: await token(page, '--accent'), color: await token(page, '--text') };
  expect(await lookOf(filter)).toEqual(open);
  await page.locator('#search').hover();
  expect(await lookOf(filter)).toEqual(open);
});
