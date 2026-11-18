import type { PanelType } from '../../contract';
import { EditorPanel } from './panel';

/**
 * The `editor` type: where the Editor docks beside the terminal, taking no room while it is not docked or nothing is open in it.
 * Placed at most once, and added as a column right after the one holding the terminal area when the layout leaves it out; `"hidden": true` on its entry means the Editor never docks, and opens as a drawer over the terminal area only.
 */
export const editorType: PanelType = {
  name: 'editor',
  options: [],
  exactlyOne: [],
  icon: 'file',
  bare: true,
  addedBeside: 'claude',
  defaultTitle: () => 'Editor',
  mount: (_slot, host) => new EditorPanel(host),
};
