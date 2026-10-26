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

/** What a colour token resolves to here, as a computed colour, to hold a rule to the token it names rather than to a value copied out of the stylesheet. */
export const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((variable) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${variable})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);

/** How far a card's line of text runs past the right edge of the column the card gives its text, in px, clipped or not; 0 when it stays inside. */
export const overrun = (line: Locator): Promise<number> =>
  line.evaluate((el) => {
    const column = el.closest('.card-content')!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const ink = Math.max(...[...range.getClientRects()].map((rect) => rect.right));
    return Math.max(0, Math.round(ink - column.right));
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

/** A colour as drawn: red, green and blue, each 0 to 255. */
export type Rgb = [number, number, number];

/** WCAG 2's contrast ratio between two colours as drawn: 1 for the same colour, up to 21 for black against white. */
export function contrast(one: Rgb, other: Rgb): number {
  const luminance = (colour: Rgb): number => {
    const [r, g, b] = colour.map((channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Every pixel of `clip` as the window draws it, row by row, from a screenshot: for what no computed style can say, such as a scrollbar's thumb, or whether something paints over it.
 * Decoded by the page's own browser, which needs nothing reached out of Playwright's internals, as `styles/compare.ts` reaches for its PNG reader.
 */
export async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Rgb[][]> {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return Array.from({ length: bitmap.height }, (_, y) =>
      Array.from({ length: bitmap.width }, (_, x): [number, number, number] => {
        const at = (y * bitmap.width + x) * 4;
        return [data[at], data[at + 1], data[at + 2]];
      }),
    );
  }, png);
}
