import type { PanelType } from '../../contract';
import { EditorPanel } from './panel';

/**
 * The `editor` type: the files opened beside the session, in tabs, taking no room while none is open.
 * Placed at most once, and added as a column right after the one holding the terminal area when the layout leaves it out; `"hidden": true` on its entry switches it off.
 */
export const editorType: PanelType = {
  name: 'editor',
  options: [],
  exactlyOne: [],
  icon: 'file',
  addedBeside: 'claude',
  defaultTitle: () => 'Editor',
  mount: (slot, host) => new EditorPanel(slot, host),
};
