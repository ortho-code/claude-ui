import type { Locator, Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// A row says what its session's tab is doing (docs/architecture.md § Tab lifecycle): `open` while it has a tab, `cold` while that tab has no claude behind it, and `active-session` for the tab on show.
// Accent means a live session, nowhere else, so the cold bar is muted where the live one is accent.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Another session' });
const fixture = { sessions: [one, two], history: { [one.id]: [], [two.id]: [] } };

const row = (page: Page, title: string): Locator => page.locator('.session', { hasText: title });

test('a row is marked open, cold and on show as its tab is', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [one.id] });
  await expect(row(page, one.title)).toHaveClass(/\bopen\b/);
  await expect(row(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bactive-session\b/);
  await expect(row(page, two.title)).not.toHaveClass(/\bopen\b/);

  // Selecting it starts it: live, and the one on show.
  await page.locator('.tab-label', { hasText: one.title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(row(page, one.title)).not.toHaveClass(/\bcold\b/);
  await expect(row(page, one.title)).toHaveClass(/\bactive-session\b/);

  // Stopped: cold again, and no longer on show.
  await page.locator('.tab .tab-close').click();
  await app.emit('onTerminalExit', 1, 0);
  await expect(row(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bactive-session\b/);
  await expect(row(page, one.title)).toHaveClass(/\bopen\b/);

  // Closed: no tab, no marks.
  await page.locator('.tab .tab-close').click();
  await expect(row(page, one.title)).not.toHaveClass(/\bopen\b/);
  await expect(row(page, one.title)).not.toHaveClass(/\bcold\b/);
});
