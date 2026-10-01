import { test } from '../support/harness';

// The checks' own gate (docs/architecture.md § The window's checks): a call the stand-in does not model fails the check, even when the window catches the refusal and nothing on screen or in the log says so.
// Marked as failing, so it passes only while that gate fails it; nothing else in it can fail. Should the call it makes ever be modelled, it passes, which is reported as a failure, and wants another call that is not.
test('a call the stand-in does not model fails the check, even when the window catches its refusal', async ({ app, page }) => {
  test.fail();
  await app.boot();
  // Caught, as the window catches a refusal it turns into a toast: nothing is thrown or logged.
  await page.evaluate(() => window.claudeUi.worktreeExists('/nowhere', 'nothing').catch(() => undefined));
});
