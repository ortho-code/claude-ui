import { changeEditorGroup, closed, closedOthers, kept, NO_GROUP, pathOf, picked, reordered, type EditorGroup } from '../../../state/editor-tabs';
import { element } from '../../../ui/dom';
import type { MenuItem } from '../../../ui/menu';
import { copyText } from '../../../ui/toast';
import type { PanelTab, PanelTabs } from '../../contract';
import { tabsHeader } from '../../headers';
import { HeaderTabs } from '../../tabs';
import './group.css';

/**
 * One group of the Editor's tabs, drawn: its tabs in a head of its own, drawn with the tabs a panel's header draws (`HeaderTabs`), and the file on show below them.
 * A press on a tab or in its menu changes the group holding that tab in the store; the files themselves are the Editor's view's (view.ts), handed in to be shown.
 */
export class EditorGroupView {
  readonly el = element('div', 'editor-group');
  private readonly tabs = new HeaderTabs();
  /** Where the Editor's own buttons sit while this group's head holds them. */
  private readonly controls = element('span', 'editor-controls');
  private readonly body = element('div', 'editor-body');

  constructor() {
    this.el.append(tabsHeader(this.tabs, [this.controls]), this.body);
  }

  /** Hold the Editor's own buttons at the end of this group's head. */
  holdControls(buttons: readonly HTMLElement[]): void {
    this.controls.replaceChildren(...buttons);
  }

  /** Draw `group`'s tabs, and below them `shown`, the view of its file on show, or nothing for null. */
  draw(group: EditorGroup, shown: HTMLElement | null): void {
    this.tabs.draw(tabsOf(group));
    if (!shown) this.body.replaceChildren();
    else if (this.body.firstChild !== shown) this.body.replaceChildren(shown);
  }
}

function tabsOf(group: EditorGroup): PanelTabs {
  return {
    tabs: group.tabs.map(
      (tab): PanelTab => ({
        id: tab.key,
        text: pathOf(tab.ref).slice(pathOf(tab.ref).lastIndexOf('/') + 1),
        tooltip: `${pathOf(tab.ref)}${tab.preview ? '\nA preview: the next file opened takes its place. Pin it, or double-click it, to keep it.' : ''}`,
        shown: tab.key === group.active,
        cold: false,
        preview: tab.preview,
        button: { mark: 'close', tooltip: 'Close' },
        cluster: null,
      }),
    ),
    add: null,
    kebabLabel: 'File options',
    select: (id) => changeEditorGroup(id, (each) => picked(each, id)),
    press: (id) => changeEditorGroup(id, (each) => closed(each, id)),
    menu: (id) => menu(group, id),
    // A double-click on a tab keeps it, as on a preview in an editor.
    rename: (id) => changeEditorGroup(id, (each) => kept(each, id)),
    reorder: (ids) => changeEditorGroup(ids[0] ?? '', (each) => reordered(each, ids)),
    showCluster: () => {},
    folded: false,
    fold: () => {},
  };
}

/** A tab's menu: Pin while it is a preview, Copy path, Close other tabs while its group has others, Close, and Close all, which closes its group, while there are others. */
function menu(group: EditorGroup, id: string): MenuItem[] | null {
  const tab = group.tabs.find((each) => each.key === id);
  if (!tab) return null;
  const path = pathOf(tab.ref);
  return [
    ...(tab.preview ? [{ label: 'Pin', onSelect: () => changeEditorGroup(id, (each) => kept(each, id)) }] : []),
    { label: 'Copy path', onSelect: () => void copyText(path, 'Path copied.') },
    ...(group.tabs.length > 1 ? [{ label: 'Close other tabs', onSelect: () => changeEditorGroup(id, (each) => closedOthers(each, id)) }] : []),
    { label: 'Close', onSelect: () => changeEditorGroup(id, (each) => closed(each, id)) },
    ...(group.tabs.length > 1 ? [{ label: 'Close all', onSelect: () => changeEditorGroup(id, () => NO_GROUP) }] : []),
  ];
}
