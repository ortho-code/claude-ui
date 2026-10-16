import type Sortable from 'sortablejs';
import { element } from '../dom';
import { drawFoldChevron, foldChevron } from '../fold-chevron';
import { Keyed, placeChildren } from '../keyed';
import { plusIcon } from '../svg';
import { buildTab, drawTab, dropSortable, sortableTabs, type TabEls } from '../tab';
import { setUnavailable, unavailable } from '../unavailable';
import type { PanelTab, PanelTabs } from './contract';
import './tabs.css';

/**
 * A PANEL'S TABS, which the tree draws in the panel's header in place of its title, from what the panel says they are (`PanelHost.setTabs`).
 * Each tab is the tab the terminal area's tab bar draws (tab.ts), kept by its id from one draw to the next and drawn again in place, so a press on one survives the panel saying its tabs again between the press and the release.
 * With clusters, each has a row of its own led by its label, as the tab bar draws a project's in All, and a drag stays inside its row; without, the tabs share one row.
 * Rows fold to one, the row of the tab on show, from the tab bar's fold chevron on the header's bottom line, which the tabs stand on.
 * A `+` follows the last tab.
 */

/** A cluster's row, with its label and its Sortable, which is made with the row and let go of when it goes (`dropSortable`). */
interface Row {
  row: HTMLElement;
  label: HTMLElement;
  sortable: Sortable;
}

export class HeaderTabs {
  readonly el = element('div', 'panel-tabs');
  /** The fold: the chevron the tab bar folds from, laid on the header's bottom line, which the tree places in the header beside the tabs. */
  readonly foldButton = foldChevron('horizontal');
  private readonly addButton = element('button', 'icon-btn compact panel-tabs-add');
  private readonly rows = new Keyed<Row>(
    (kept) => kept.row,
    (kept) => dropSortable(kept.sortable),
  );
  private readonly tabs = new Keyed<TabEls>((kept) => kept.el);
  /** The strip's own Sortable, for the one row without clusters; off while rows hold the tabs, which are then their rows' to drag. */
  private readonly flat: Sortable;
  /** The tabs as the panel last said them, whose actions every press goes to. */
  private said: PanelTabs | null = null;
  /** While a tab is dragged the library moves the tabs itself, so a draw then would undo the drag under the pointer: it is held until the drop. */
  private dragging = false;
  private held = false;

  constructor() {
    this.addButton.type = 'button';
    this.addButton.innerHTML = plusIcon(14);
    this.addButton.addEventListener('click', () => {
      if (!unavailable(this.addButton)) this.said?.add();
    });
    this.flat = sortableTabs(this.el, this.dragEnds());
    this.foldButton.classList.add('panel-tabs-fold');
    this.foldButton.hidden = true;
    this.foldButton.addEventListener('click', () => {
      if (this.said) this.said.fold(!this.said.folded);
    });
  }

  /** Draw the tabs as the panel says them now. */
  draw(said: PanelTabs): void {
    this.said = said;
    if (this.dragging) {
      this.held = true;
      return;
    }
    setUnavailable(this.addButton, said.addRefused, said.addLabel);
    this.addButton.setAttribute('aria-label', said.addLabel);
    const clustered = said.tabs.some((tab) => tab.cluster !== null);
    this.flat.option('disabled', clustered);
    if (!clustered) {
      placeChildren(this.el, [...said.tabs.map((tab) => this.drawOne(tab)), this.addButton]);
    } else {
      // Rows by key, a tab in no cluster in a row of its own with no label, under a key no cluster's can be.
      const order: string[] = [];
      const byCluster = new Map<string, { label: string | null; tabs: PanelTab[] }>();
      for (const tab of said.tabs) {
        const key = tab.cluster ? `c${tab.cluster.key}` : 'none';
        let cluster = byCluster.get(key);
        if (!cluster) {
          cluster = { label: tab.cluster?.label ?? null, tabs: [] };
          byCluster.set(key, cluster);
          order.push(key);
        }
        cluster.tabs.push(tab);
      }
      // Folded, one row: the one holding the tab on show, or with none on show the first, as the tab bar folds.
      const kept = order.find((key) => byCluster.get(key)!.tabs.some((tab) => tab.shown)) ?? order[0];
      const drawn = said.folded ? order.filter((key) => key === kept) : order;
      const rows = drawn.map((key, at) => {
        const { label, tabs } = byCluster.get(key)!;
        const row = this.rows.draw(key, (k) => this.buildRow(k.slice(1)));
        if (label !== null) row.label.textContent = label;
        // The `+` after the last tab, in the last row.
        placeChildren(row.row, [...(label === null ? [] : [row.label]), ...tabs.map((tab) => this.drawOne(tab)), ...(at === drawn.length - 1 ? [this.addButton] : [])]);
        return row.row;
      });
      placeChildren(this.el, rows);
    }
    if (!clustered) this.rows.clear();
    else this.rows.sweep();
    this.tabs.sweep();
    // The fold is there while the tabs are in rows, folded or not, as the tab bar's stays on a bar of one row: folded is a stance that holds once a second row appears.
    this.foldButton.hidden = !clustered;
    drawFoldChevron(this.foldButton, said.folded ? 'down' : 'up', said.folded ? 'Unfold the tabs' : 'Fold the tabs to one row');
    this.foldButton.setAttribute('aria-expanded', String(!said.folded));
  }

  private drawOne(tab: PanelTab): HTMLElement {
    const els = this.tabs.draw(tab.id, (id) => this.buildOne(id));
    drawTab(els, {
      active: tab.shown,
      cold: tab.cold,
      text: tab.text,
      tooltip: tab.tooltip,
      button: { mark: tab.button.mark, tooltip: tab.button.tooltip, disabled: false },
      lead: [],
    });
    return els.el;
  }

  /** A tab, built once: every press asks the panel, by the tab's id, as the panel last said its tabs. */
  private buildOne(id: string): TabEls {
    const els = buildTab({
      select: () => this.said?.select(id),
      press: () => this.said?.press(id),
      menu: () => this.said?.menu(id) ?? null,
      kebabLabel: this.said?.kebabLabel ?? 'Options',
    });
    els.el.dataset.tab = id;
    els.el.addEventListener('dblclick', (event) => {
      // A double-click on its buttons is two presses of them, not a rename.
      if ((event.target as Element).closest('button')) return;
      this.said?.rename(id);
    });
    return els;
  }

  /** A cluster's row, led by its label, which takes you to what the cluster is. */
  private buildRow(key: string): Row {
    const row = element('div', 'tab-project');
    const label = element('span', 'tab-row-label tab-project-label');
    label.addEventListener('click', () => this.said?.showCluster(key));
    return { row, label, sortable: sortableTabs(row, this.dragEnds()) };
  }

  /** What a drag does at its start and its end: holds the draws, then hands the panel its row's new order and draws what was held. */
  private dragEnds(): { start(): void; end(event: Sortable.SortableEvent): void } {
    return {
      start: () => {
        this.dragging = true;
      },
      end: (event) => {
        this.dragging = false;
        const ids = [...event.to.querySelectorAll<HTMLElement>('.tab')].map((el) => el.dataset.tab ?? '');
        // After the drop has finished, as the tab bar does, so the library is done with the row first.
        queueMicrotask(() => {
          if (event.oldIndex !== event.newIndex) this.said?.reorder(ids);
          if (this.held && this.said) {
            this.held = false;
            this.draw(this.said);
          }
        });
      },
    };
  }
}
