import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { hoveredAndOpen } from '../../../../support/looks';

// Every control in the list that opens a menu keeps the look it shows on hover for as long as its menu is up, the pointer gone onto the menu (docs/architecture.md § UI conventions).
const grouped = session({ title: 'In a group' });
const fixture = {
  sessions: [grouped],
  groupState: {
    groups: [
      { id: 'g-alpha', name: 'Alpha', repoRoot: PROJECT },
      { id: 'g-beta', name: 'Beta', repoRoot: PROJECT },
    ],
    groupOf: { [grouped.id]: 'g-alpha' },
  },
};

for (const [name, trigger] of [
  ["the project's kebab", '.project-kebab'],
  ["the project's group jump", '.project-groups'],
  ["the project's new-session caret", '.project-add-caret'],
  ["a group's new-session caret", '.group-add-caret'],
  ["a group's kebab", '.group-kebab'],
  ["a session's kebab", '.session-kebab'],
] as const) {
  test(`${name} keeps its hover look while its menu is up`, async ({ app, page }) => {
    await app.boot(fixture);
    const { hovered, open } = await hoveredAndOpen(page, page.locator(trigger).first());
    expect(open).toEqual(hovered);
  });
}
