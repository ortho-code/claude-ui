import { expect, test } from '../../../support/harness';
import { lookOf, token } from '../../../support/looks';

// The sidebar's header buttons stand side by side as peers, so they hover alike, to `--surface-hover`, and the ones that open something show it in `--active`, a stronger step than their hover: the ladder a live tab and the switcher's title climb too (docs/architecture.md § UI conventions).

test('every header button hovers to the same fill and outline', async ({ app, page }) => {
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
