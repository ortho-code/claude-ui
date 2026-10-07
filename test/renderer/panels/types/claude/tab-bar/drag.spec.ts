import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { stripNames, tab, tabLabel, tabLabels } from '../../../../support/window';

// Dragging a tab moves it within its own row, and the order is yours from then on: kept for the next launch, and the one the live strip lists running sessions in (docs/architecture.md § Traps worth knowing).
const first = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'First tab' });
const second = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Second tab' });
const fixture = {
  sessions: [first, second],
  activeProject: null,
  openSessions: [first.id, second.id],
  history: { [first.id]: [], [second.id]: [] },
};


test('a tab dragged before another moves there, in the bar, in what is kept and in the strip', async ({ app, page }) => {
  await app.boot(fixture);
  // Running is what puts a session in the strip.
  for (const s of [first, second]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await expect.poll(() => stripNames(page).allTextContents()).toEqual([first.title, second.title]);

  const from = (await tab(page, second.title).boundingBox())!;
  const to = (await tab(page, first.title).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(tabLabels(page)).toHaveText([second.title, first.title]);
  await expect.poll(async () => (await app.calls('setOpenSessions')).at(-1)).toEqual([[second.id, first.id], [second.id, first.id]]);
  await expect.poll(() => stripNames(page).allTextContents()).toEqual([second.title, first.title]);
});
