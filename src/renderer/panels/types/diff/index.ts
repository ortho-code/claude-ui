import type { PanelType } from '../../contract';
import { DIFF_OPTIONS, DiffPanel } from './panel';

/**
 * The `diff` panel type: what changed in the checkout a panel looks in, read from git.
 * The app's own, since a list a script prints cannot draw a diff; one a layout does not place costs nothing.
 */
export const diffType: PanelType = {
  ...DIFF_OPTIONS,
  icon: 'diff',
  defaultTitle: () => 'Changes',
  mount: (slot, host) => new DiffPanel(slot, host),
};
