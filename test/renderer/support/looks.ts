import type { Locator, Page } from '@playwright/test';

/** What a control shows: its fill, its outline and its mark's colour, as computed. */
export interface Look {
  background: string;
  border: string;
  color: string;
}

export const lookOf = (control: Locator): Promise<Look> =>
  control.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, border: style.borderTopColor, color: style.color };
  });

/**
 * A menu's trigger as it looks hovered with its menu shut, and as it looks with its menu up and the pointer on the menu, which the UI conventions hold to be the same look (docs/architecture.md § UI conventions).
 * The menu is shut again after, by the trigger, as a second press does.
 */
export async function hoveredAndOpen(page: Page, trigger: Locator): Promise<{ hovered: Look; open: Look }> {
  await trigger.hover();
  const hovered = await lookOf(trigger);
  await trigger.click();
  await page.locator('.kebab-menu button').first().hover();
  const open = await lookOf(trigger);
  await trigger.click();
  return { hovered, open };
}
