import type { Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { tabBarGroups, tabBarProjects, tabBarRows, tabLabelsIn } from '../../../../support/window';

const OTHER = `${HOME}/projects/other`;
const loose = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Loose in demo' });
const inFirst = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'In First' });
const inSecond = session({ id: '00000000-0000-4000-8000-0000000000a3', title: 'In Second' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'In other', cwd: OTHER, repoRoot: OTHER });

/** What a colour token resolves to here, as a computed colour, to hold a rule to the token it names rather than to a value copied out of the stylesheet. */
const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((variable) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);

// The bar used to order projects by whichever it met first; it takes the order the user set, the same one the sidebar and the attention strip use (the one-behaviour rule in CLAUDE.md).
test('the tab bar sits projects in the order you set and groups in their registry order, whatever order the tabs were opened in', async ({ app, page }) => {
  await app.boot({
    sessions: [loose, inFirst, inSecond, elsewhere],
    projectOrder: [PROJECT, OTHER],
    activeProject: null,
    // Opened other-project first, and the later group before the earlier one.
    openSessions: [elsewhere.id, inFirst.id, inSecond.id, loose.id],
    groupState: {
      groups: [
        { id: 'g-second', name: 'Second', repoRoot: PROJECT },
        { id: 'g-first', name: 'First', repoRoot: PROJECT },
      ],
      groupOf: { [inFirst.id]: 'g-first', [inSecond.id]: 'g-second' },
    },
  });

  const rows = tabBarRows(page);
  await expect(rows).toHaveCount(4);
  const clusters = await rows.evaluateAll((all) => all.map((row) => (row as HTMLElement).dataset.cluster));
  expect(clusters).toEqual([`${PROJECT}\0`, `${PROJECT}\0g-second`, `${PROJECT}\0g-first`, `${OTHER}\0`]);
  await expect(tabLabelsIn(rows.nth(0))).toHaveText([loose.title]);
  await expect(tabLabelsIn(rows.nth(3))).toHaveText([elsewhere.title]);

  // A live project's label is in the text colour, like its heading in the sidebar; a group's icon is muted beside its name (lost once to a renamed class, 5c7afd7).
  await expect(tabBarProjects(page).first()).toHaveCSS('color', await token(page, '--text'));
  await expect(tabBarGroups(page).first().locator('.heading-icon')).toHaveCSS('color', await token(page, '--muted'));
});
