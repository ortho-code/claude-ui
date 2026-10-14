import { session } from '../support/fixture';
import { expect, test } from '../support/harness';

// Every kebab is one builder (`kebabButton`, menu.ts), so it names itself once for all of them: an icon-only control carries a tooltip and an aria-label (docs/architecture.md § UI conventions).
// The kebabs this window draws stand in for the rest, which share the builder.

test("the project's, the session row's and the tab's kebab each have their tooltip as their accessible name", async ({ app, page }) => {
  const one = session();
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [] } });
  const kebabs = page.locator('.icon-btn.kebab');
  await expect(kebabs).toHaveCount(3);
  for (const kebab of await kebabs.all()) {
    const said = await kebab.getAttribute('data-tooltip');
    expect(said).toBeTruthy();
    await expect(kebab).toHaveAccessibleName(said!);
  }
});
