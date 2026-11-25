import type Sortable from 'sortablejs';
import { element } from '../ui/dom';
import { drawFoldChevron, foldChevron, offerRowFold } from '../ui/fold-chevron';
import { Keyed, placeChildren } from '../ui/keyed';
import { plusIcon } from '../ui/svg';
import { buildTab, drawTab, dropSortable, sortableTabs, type TabEls } from '../ui/tab';
import { setUnavailable, unavailable } from '../ui/unavailable';
import type { PanelTab, PanelTabs } from './contract';
import './tabs.css';

/**
 * A PANEL'S TABS, which the tree draws in the panel's header in place of its title, from what the panel says they are (`PanelHost.setTabs`).
 * Each tab is the tab the terminal area's tab bar draws (tab.ts), kept by its id from one draw to the next and drawn again in place, so a press on one survives the panel saying its tabs again between the press and the release.
 * With clusters, each has a row of its own led by its label, as the tab bar draws a project's in All, and a drag stays inside its row; without, the tabs share one row.
 * Rows fold to one, the row of the tab on show, from the tab bar's fold chevron on the header's bottom line, which the tabs stand on.
 * A `+` follows the last tab when the panel can add one, and a preview's label is in italics.
 */

/** A cluster's row, with its label and its Sortable, which is made with the row and let go of when it goes (`dropSortable`). */
interface Row {
  row: HTMLElement;
  label: HTMLElement;
  sortable: Sortable;
}

/** The strips of each drag group: the library moves a dragged tab into any of them under the pointer, so a drag out of one holds the draws of those in the group when it starts. */
const stripsOf = new Map<string, Set<HeaderTabs>>();

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

  /**
   * `dragGroup` names the strips a tab of this one's flat row can be dragged into, and from; null keeps every drag inside its row.
   * A strip in a drag group is let go of with `release` when it leaves the window.
   */
  constructor(private readonly dragGroup: string | null = null) {
    if (dragGroup !== null) stripsOf.set(dragGroup, (stripsOf.get(dragGroup) ?? new Set<HeaderTabs>()).add(this));
    this.addButton.type = 'button';
    this.addButton.innerHTML = plusIcon(14);
    this.addButton.addEventListener('click', () => {
      if (!unavailable(this.addButton)) this.said?.add?.press();
    });
    this.flat = sortableTabs(this.el, this.dragEnds(), dragGroup);
    this.foldButton.classList.add('panel-tabs-fold');
    this.foldButton.hidden = true;
    this.foldButton.addEventListener('click', () => {
      if (this.said) this.said.fold(!this.said.folded);
    });
  }

  /** Take the strip out of its drag group and let go of its rows' Sortables, as it leaves the window. */
  release(): void {
    if (this.dragGroup !== null) stripsOf.get(this.dragGroup)?.delete(this);
    this.rows.clear();
    dropSortable(this.flat);
  }

  /** This strip and the others of its drag group, which a drag out of it reaches. */
  private reached(): HeaderTabs[] {
    return this.dragGroup === null ? [this] : [...(stripsOf.get(this.dragGroup) ?? [this])];
  }

  /** Draw what was said while a drag held the draws. */
  private drawHeld(): void {
    if (!this.held || !this.said) return;
    this.held = false;
    this.draw(this.said);
  }

  /** Draw the tabs as the panel says them now. */
  draw(said: PanelTabs): void {
    this.said = said;
    if (this.dragging) {
      this.held = true;
      return;
    }
    const add = said.add ? [this.addButton] : [];
    if (said.add) {
      setUnavailable(this.addButton, said.add.refused, said.add.label);
      this.addButton.setAttribute('aria-label', said.add.label);
    }
    const clustered = said.tabs.some((tab) => tab.cluster !== null);
    this.flat.option('disabled', clustered);
    /** How many rows the tabs stand in unfolded. */
    let rowCount = 1;
    if (!clustered) {
      placeChildren(this.el, [...said.tabs.map((tab) => this.drawOne(tab)), ...add]);
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
      rowCount = order.length;
      // Folded, one row: the one holding the tab on show, or with none on show the first, as the tab bar folds.
      const kept = order.find((key) => byCluster.get(key)!.tabs.some((tab) => tab.shown)) ?? order[0];
      const drawn = said.folded ? order.filter((key) => key === kept) : order;
      const rows = drawn.map((key, at) => {
        const { label, tabs } = byCluster.get(key)!;
        const row = this.rows.draw(key, (k) => this.buildRow(k.slice(1)));
        if (label !== null) row.label.textContent = label;
        // The `+` after the last tab, in the last row.
        placeChildren(row.row, [...(label === null ? [] : [row.label]), ...tabs.map((tab) => this.drawOne(tab)), ...(at === drawn.length - 1 ? add : [])]);
        return row.row;
      });
      placeChildren(this.el, rows);
    }
    if (!clustered) this.rows.clear();
    else this.rows.sweep();
    this.tabs.sweep();
    offerRowFold(this.foldButton, rowCount);
    drawFoldChevron(this.foldButton, said.folded ? 'down' : 'up', said.folded ? 'Unfold the tabs' : 'Fold the tabs to one row');
    this.foldButton.setAttribute('aria-expanded', String(!said.folded));
  }

  private drawOne(tab: PanelTab): HTMLElement {
    const els = this.tabs.draw(tab.id, (id) => this.buildOne(id));
    drawTab(els, {
      active: tab.shown,
      cold: tab.cold,
      classes: tab.preview ? ['preview'] : [],
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

  /**
   * What a drag does at its start and its end: holds the draws of the strips of its drag group as it starts, then hands the panel its row's new order, or the tab dropped into another strip's row and where, and lets go of and draws what those strips held.
   * A strip that joins the group during the drag is not held.
   */
  private dragEnds(): { start(): void; end(event: Sortable.SortableEvent): void } {
    let reached: HeaderTabs[] = [];
    return {
      start: () => {
        reached = this.reached();
        for (const strip of reached) strip.dragging = true;
      },
      end: (event) => {
        for (const strip of reached) strip.dragging = false;
        const ids = [...event.to.querySelectorAll<HTMLElement>('.tab')].map((el) => el.dataset.tab ?? '');
        const id = event.item.dataset.tab ?? '';
        // After the drop has finished, as the tab bar does, so the library is done with the row first.
        queueMicrotask(() => {
          if (event.from !== event.to) this.said?.moveAcross?.(id, ids.indexOf(id));
          else if (event.oldIndex !== event.newIndex) this.said?.reorder(ids);
          for (const strip of reached) strip.drawHeld();
        });
      },
    };
  }
}
