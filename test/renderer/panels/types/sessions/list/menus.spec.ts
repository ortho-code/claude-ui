import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { hoveredAndOpen, lookOf, token } from '../../../../support/looks';

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

// Every kebab hugs its three dots, one width wherever it is: a heading's, a session row's, a strip row's and a tab's.
test('every kebab is 12px wide, in the list, the strip and the tab bar alike', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [grouped.id], pausedSessions: [grouped.id], history: { [grouped.id]: [] } });
  for (const kebab of ['.project-kebab', '.group-kebab', '.session-kebab', '.strip-item-kebab', '.tab-kebab']) {
    const box = (await page.locator(kebab).first().boundingBox())!;
    expect(Math.round(box.width), kebab).toBe(12);
  }
});

// A borderless icon button turns its mark accent on hover and while its menu is up, with no fill or outline; a bordered one fills and outlines.
test('a borderless icon button only turns accent on hover and while its menu is up, and a bordered one fills', async ({ app, page }) => {
  await app.boot(fixture);
  const none = 'rgba(0, 0, 0, 0)';
  const text = await token(page, '--text');
  const kebab = page.locator('.session-kebab').first();
  const accented = { background: none, border: none, color: await token(page, '--accent') };

  const { hovered, open } = await hoveredAndOpen(page, kebab);
  expect(hovered).toEqual(accented);
  expect(open).toEqual(accented);
  const pin = page.locator('.session .pin').first();
  await pin.hover();
  expect(await lookOf(pin)).toEqual(accented);

  // A group's + fills as framed icon buttons do; a project's + keeps its own lighter fill, since it sits on a filled bar.
  const groupAdd = page.locator('.group h3 .split-button .icon-btn').first();
  await groupAdd.hover();
  expect(await lookOf(groupAdd)).toEqual({ background: await token(page, '--active'), border: await token(page, '--accent'), color: text });
  const projectAdd = page.locator('.project h2 .split-button .icon-btn').first();
  await projectAdd.hover();
  expect((await lookOf(projectAdd)).background).toBe(await token(page, '--surface-hover'));
});

// A menu's notch points at the middle of what opened it, a narrow kebab too, which a menu flush with its right edge used to miss.
test("a kebab's menu points its notch at the kebab's dots", async ({ app, page }) => {
  await app.boot(fixture);
  const kebab = page.locator('.session-kebab').first();
  await kebab.click();
  const menu = page.locator('.kebab-menu');
  await expect(menu).toBeVisible();
  const kebabBox = (await kebab.boundingBox())!;
  const notchCentre = await menu.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const notch = getComputedStyle(el, '::before');
    // The notch's whole box, its borders too, since it is no border-box: its rotation turns it about that box's centre.
    const across = parseFloat(notch.width) + parseFloat(notch.borderLeftWidth) + parseFloat(notch.borderRightWidth);
    return box.left + parseFloat(getComputedStyle(el).borderLeftWidth) + parseFloat(notch.left) + across / 2;
  });
  expect(Math.abs(notchCentre - (kebabBox.x + kebabBox.width / 2))).toBeLessThanOrEqual(0.1);
});

// A heading's kebab stands 8px off the bordered new-session button before it, where a session row's sits 4px after its pin.
test("a heading's kebab sits 8px after its new-session button, and a session row's 4px after its pin", async ({ app, page }) => {
  await app.boot(fixture);
  const gap = async (before: string, after: string): Promise<number> => {
    const left = (await page.locator(before).first().boundingBox())!;
    const right = (await page.locator(after).first().boundingBox())!;
    return Math.round(right.x - (left.x + left.width));
  };
  expect(await gap('.project h2 .split-button', '.project-kebab')).toBe(8);
  expect(await gap('.group h3 .split-button', '.group-kebab')).toBe(8);
  expect(await gap('.session .pin', '.session-kebab')).toBe(4);
});
