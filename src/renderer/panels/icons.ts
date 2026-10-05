/**
 * The icons a panel can wear on a rail, by name.
 *
 * Drawn on the app's 16-unit grid with the ink centred on (8,8) and stroked in `currentColor`, like every other mark in the app, so they follow the theme and sit level with the controls beside them.
 * The set is fixed in this build: a type names its default, and an entry's `icon` picks another by name.
 * Icons of a person's own, from a file in the config folder, are a later addition that would sit beside these names.
 * Pure strings, so the validator can check a name without a DOM.
 */

import { strokeIcon } from '../svg';

export const ICONS = {
  sessions:
    '<circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none" /><circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" /><circle cx="3" cy="12" r="0.9" fill="currentColor" stroke="none" /><path d="M6 4h7.5M6 8h7.5M6 12h7.5" />',
  claude: '<path d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6" />',
  command: '<path d="M3 4.5l3.5 3.5L3 11.5M8.5 11.5H13" />',
  terminal: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" /><path d="M4.6 6.2l2 1.8-2 1.8M8.4 10h3" />',
  git: '<circle cx="5" cy="3.6" r="1.5" /><circle cx="5" cy="12.4" r="1.5" /><circle cx="11" cy="5.2" r="1.5" /><path d="M5 5.1v5.8M11 6.7c0 2.6-6 2.2-6 4.2" />',
  list: '<path d="M3 4h10M3 8h10M3 12h6.5" />',
  check: '<path d="M3 8.6l3.2 3.2L13 4.8" />',
  eye: '<path d="M1.6 8S4 3.8 8 3.8 14.4 8 14.4 8 12 12.2 8 12.2 1.6 8 1.6 8z" /><circle cx="8" cy="8" r="2" />',
  bug: '<rect x="5" y="5" width="6" height="8.2" rx="3" /><path d="M8 7.5v5M5 8.5H2.6M13.4 8.5H11M5.2 11.4l-2 1.4M10.8 11.4l2 1.4M6.2 5.2L4.8 3.4M9.8 5.2l1.4-1.8" />',
  book: '<path d="M2.4 3.6h4A1.6 1.6 0 0 1 8 5.2v8a1.6 1.6 0 0 0-1.6-1.6h-4zM13.6 3.6h-4A1.6 1.6 0 0 0 8 5.2v8a1.6 1.6 0 0 1 1.6-1.6h4z" />',
  clock: '<circle cx="8" cy="8" r="6" /><path d="M8 4.6V8l2.4 1.6" />',
  server: '<rect x="2.4" y="2.6" width="11.2" height="4.4" rx="1.2" /><rect x="2.4" y="9" width="11.2" height="4.4" rx="1.2" /><path d="M5 4.8h.01M5 11.2h.01" />',
  play: '<path d="M5 3.4l7 4.6-7 4.6z" />',
  search: '<circle cx="7" cy="7" r="4.4" /><path d="M10.4 10.4L14 14" />',
  bell: '<path d="M4 11V7.2a4 4 0 0 1 8 0V11l1.2 1.4H2.8zM6.6 14.2h2.8" />',
  /** Not for a type: the mark of an entry that cannot run, so a broken panel stands out on a rail too. */
  alert: '<path d="M8 2.4L14.2 13H1.8z" /><path d="M8 6.6v3M8 11.4h.01" />',
} as const;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export const isIconName = (value: unknown): value is IconName => typeof value === 'string' && Object.hasOwn(ICONS, value);

/** An icon as SVG markup, at `size` px, through the one helper every stroked icon in the app is drawn with. */
export const iconSvg = (name: IconName, size = 14): string => strokeIcon(size, ICONS[name]);
