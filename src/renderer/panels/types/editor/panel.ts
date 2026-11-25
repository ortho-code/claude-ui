import { store } from '../../../state/app';
import { editorDocked, editorTabsOnShow } from '../../../state/editor-tabs';
import { element } from '../../../ui/dom';
import type { MountedPanel, PanelHost } from '../../contract';
import { dockIn } from './controller';
import './panel.css';

/**
 * The Editor panel: where the layout places the Editor docked beside the terminal.
 * It holds the Editor's one view only while the Editor is docked (controller.ts), and takes no room otherwise, or while nothing is open in it (`setVacant`).
 * Bare, since the view brings its own head, which takes the panel's full-screen button while docked.
 */
export class EditorPanel implements MountedPanel {
  readonly el = element('div', 'panel-body editor-panel');
  private readonly stopWatching: () => void;

  constructor(private readonly host: PanelHost) {
    store.set({ editorDock: true });
    dockIn({ body: this.el, fullScreen: host.fullScreenButton, bringIntoView: () => host.bringIntoView() });
    this.stopWatching = store.watch(['editorTabs', 'tabs', 'activeTab', 'editorUi', 'editorDock'], () => this.drawVacant());
    this.drawVacant();
  }

  refresh(): void {}
  contextChanged(): void {}
  setVisible(): void {}
  recheck(): void {}

  unmount(): void {
    this.stopWatching();
    dockIn(null);
    store.set({ editorDock: false });
  }

  private drawVacant(): void {
    this.host.setVacant(!editorDocked() || editorTabsOnShow().groups.length === 0);
  }
}
