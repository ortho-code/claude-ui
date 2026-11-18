import type { MountedPanel, PanelType } from '../../contract';
import { element } from '../../../ui/dom';

/**
 * The `editor` type: the place beside the session that files are to open in, taking no room while nothing is open in it.
 * Placed at most once, and added as a column right after the one holding the terminal area when the layout leaves it out; `"hidden": true` on its entry switches it off.
 */
export const editorType: PanelType = {
  name: 'editor',
  options: [],
  exactlyOne: [],
  icon: 'file',
  addedBeside: 'claude',
  defaultTitle: () => 'Editor',
  mount: (_slot, host): MountedPanel => {
    // Nothing opens in it yet, so it has nothing to show.
    host.setVacant(true);
    return {
      el: element('div', 'panel-body editor-panel'),
      refresh: () => {},
      contextChanged: () => {},
      setVisible: () => {},
      recheck: () => {},
      unmount: () => {},
    };
  },
};
