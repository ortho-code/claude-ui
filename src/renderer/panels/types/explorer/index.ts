import type { PanelType } from '../../contract';
import { EXPLORER_OPTIONS, ExplorerPanel } from './panel';

/**
 * The `explorer` panel type: what changed in the checkout a panel looks in, read from git.
 * The app's own, since a list a script prints cannot draw a diff; one a layout does not place costs nothing.
 */
export const explorerType: PanelType = {
  ...EXPLORER_OPTIONS,
  icon: 'diff',
  defaultTitle: () => 'Changes',
  mount: (slot, host) => new ExplorerPanel(slot, host),
};
