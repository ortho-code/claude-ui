import { session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { row } from '../../../support/window';

// A session with an older copy of its transcript, one another copy replaced, carries a mark on its row saying what that copy holds that the session's history lacks, until Claude Code's cleanup deletes it (docs/architecture/sessions.md § Superseded copies).
const COPY = { stamp: '1795440916583', at: 1795440916583, missing: 67 };
const split = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Split session', supersededCopies: [COPY] });
const whole = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Whole session' });

test('a session with an older copy of its transcript says on its row how many requests that copy holds that its history lacks', async ({ app, page }) => {
  await app.boot({ sessions: [split, whole] });
  const mark = row(page, split.title).locator('.superseded-mark');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveClass(/\bsuperseded-badge\b/);
  await expect(mark).toHaveAttribute('data-tooltip', /^An older copy of this session, replaced .+, has 67 requests the current one lacks\.$/);
  await expect(row(page, whole.title).locator('.superseded-mark')).toBeHidden();
});

test('the mark comes with a copy and goes once Claude Code has deleted it', async ({ app, page }) => {
  await app.boot({ sessions: [whole] });
  const mark = row(page, whole.title).locator('.superseded-mark');
  await expect(mark).toBeHidden();
  await app.listOnDisk([{ ...whole, supersededCopies: [{ ...COPY, missing: 1 }] }]);
  await expect(mark).toHaveAttribute('data-tooltip', /has 1 request the current one lacks\.$/);
  await app.listOnDisk([whole]);
  await expect(mark).toBeHidden();
});
