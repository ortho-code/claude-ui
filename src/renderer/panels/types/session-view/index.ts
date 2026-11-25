import type { PanelType } from '../../contract';
import { SESSION_VIEW_OPTIONS, SessionViewPanel } from './panel';

/**
 * The `session-view` panel type: a view of the sessions, such as Now, drawn as the session list's own rows.
 * The app's own, any number of them, since what it draws is the store's; one a layout does not place costs nothing.
 */
export const sessionViewType: PanelType = {
  ...SESSION_VIEW_OPTIONS,
  icon: 'bell',
  defaultTitle: () => 'Now',
  actionLabel: () => null,
  mount: (_slot, host) => new SessionViewPanel(host),
};
