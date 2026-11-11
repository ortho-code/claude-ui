import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { metaDir, useMetaDir, writeMetaFile } from '../sessions/meta-fixture';

vi.mock('electron', async () => (await import('../sessions/meta-fixture')).electronStub);

// A filter that defaults to on, for the one check that needs one: none does yet, and the rule for a key a file does not have is only seen with one.
const { defaultsWith } = vi.hoisted(() => ({ defaultsWith: { pinnedOn: false } }));
vi.mock('../../../../src/shared/config/defaults', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/shared/config/defaults')>();
  return {
    ...actual,
    defaultUi: () => {
      const ui = actual.defaultUi();
      return defaultsWith.pinnedOn ? { ...ui, filters: { ...ui.filters, pinned: true } } : ui;
    },
  };
});

import { getUiState, setUiState } from '../../../../src/main/sessions/meta';

useMetaDir();

describe('the live strip\'s stored keys', () => {
  it('are not read, and leave the file at the next write', async () => {
    await writeMetaFile({ footerExpanded: false, ui: { footerExpanded: false, stripExpanded: false, stripHiddenProjects: ['/a'] }, version: 3 });
    const before = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(before.ui.stripHiddenProjects).toEqual(['/a']);
    const ui = await getUiState();
    expect(Object.keys(ui)).not.toContain('stripExpanded');
    expect(Object.keys(ui)).not.toContain('stripHiddenProjects');
    await setUiState(ui);
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.footerExpanded).toBeUndefined();
    expect(raw.ui.footerExpanded).toBeUndefined();
    expect(raw.ui.stripExpanded).toBeUndefined();
    expect(raw.ui.stripHiddenProjects).toBeUndefined();
  });
});

describe('tabBarExpanded', () => {
  it('starts expanded, every tab in sight', async () => {
    expect((await getUiState()).tabBarExpanded).toBe(true);
  });

  it('remembers being folded, and being opened again', async () => {
    const ui = await getUiState();
    await setUiState({ ...ui, tabBarExpanded: false });
    expect((await getUiState()).tabBarExpanded).toBe(false);
    await setUiState({ ...ui, tabBarExpanded: true });
    expect((await getUiState()).tabBarExpanded).toBe(true);
  });

  it('takes the default when an older meta.json never mentioned it, or holds something else', async () => {
    await writeMetaFile({ ui: { filterPanelOpen: true }, version: 3 });
    expect((await getUiState()).tabBarExpanded).toBe(true);
    await writeMetaFile({ ui: { tabBarExpanded: 'no' }, version: 3 });
    expect((await getUiState()).tabBarExpanded).toBe(true);
  });
});

describe('ui state', () => {
  const view = {
    search: 'psalm',
    filters: { pinned: true, open: false, live: false, setAside: false, worktree: false, gone: false, siblings: false, prs: false, noted: false, finished: false },
    datePreset: 'custom',
    dateFrom: 1_700_000_000_000,
    dateTo: 1_700_500_000_000,
    filterPanelOpen: true,
    tabBarExpanded: false,
    collapsedProjects: ['/home/me/work'],
    collapsedGroups: ['g1'],
    filterCollapsedProjects: ['/home/me/other'],
    filterCollapsedGroups: ['g2'],
    sidebarWidth: 380,
    scrollTop: 240,
    panelState: {
      sizes: { window: { sidebar: 300, main: 1100 }, work: { claude: 800, side: 300 } },
      collapsed: ['drawer'],
      active: { side: 'reviews' },
    },
  };

  it('starts unfiltered, unfolded and at the default width', async () => {
    expect(await getUiState()).toEqual({
      search: '',
      filters: { pinned: false, open: false, live: false, setAside: false, worktree: false, gone: false, siblings: false, prs: false, noted: false, finished: false },
      datePreset: 'any',
      dateFrom: null,
      dateTo: null,
      filterPanelOpen: false,
      tabBarExpanded: true,
      collapsedProjects: [],
      collapsedGroups: [],
      filterCollapsedProjects: [],
      filterCollapsedGroups: [],
      sidebarWidth: null,
      scrollTop: 0,
      panelState: { sizes: {}, collapsed: [], active: {} },
    });
  });

  it('stores and reads back a whole view', async () => {
    await setUiState(view);
    expect(await getUiState()).toEqual(view);
  });

  it('fills in what an older meta.json never stored', async () => {
    await writeMetaFile({ ui: { search: 'psalm' }, version: 3 });
    const ui = await getUiState();
    expect(ui.search).toBe('psalm');
    expect(ui.filters.pinned).toBe(false);
    expect(ui.datePreset).toBe('any');
    expect(ui.collapsedProjects).toEqual([]);
    expect(ui.filterCollapsedProjects).toEqual([]);
    expect(ui.panelState).toEqual({ sizes: {}, collapsed: [], active: {} });
  });

  it('drops the first slice’s side width rather than carrying it into the tree', async () => {
    await writeMetaFile({ ui: { panelState: { width: 420 } }, version: 3 });
    expect((await getUiState()).panelState).toEqual({ sizes: {}, collapsed: [], active: {} });
  });

  it('keeps the tree state’s well-formed entries and drops the rest, one by one', async () => {
    await writeMetaFile({
      ui: {
        panelState: {
          sizes: { window: { sidebar: 300, main: 0, side: -4, drawer: '200' }, work: 'wide', gone: { a: null }, list: [1, 2] },
          collapsed: ['drawer', 3, null, 'side'],
          active: { side: 'reviews', work: 7, drawer: null },
        },
      },
      version: 3,
    });
    expect((await getUiState()).panelState).toEqual({
      sizes: { window: { sidebar: 300 } },
      collapsed: ['drawer', 'side'],
      active: { side: 'reviews' },
    });
  });

  it('starts the tree state empty when it is not an object at all', async () => {
    for (const panelState of ['x', 3, null, [1]]) {
      await writeMetaFile({ ui: { panelState }, version: 3 });
      expect((await getUiState()).panelState).toEqual({ sizes: {}, collapsed: [], active: {} });
    }
  });

  it('drops values of the wrong type rather than restoring a broken sidebar', async () => {
    await writeMetaFile({
      ui: { search: 42, filters: 'all', collapsedProjects: ['/a', 7, null], scrollTop: 'top' },
      version: 3,
    });
    const ui = await getUiState();
    expect(ui.search).toBe('');
    expect(ui.filters.pinned).toBe(false);
    expect(ui.collapsedProjects).toEqual(['/a']);
    expect(ui.scrollTop).toBe(0);
  });

  it('keeps the folds made while filtering apart from the folds made without one', async () => {
    await setUiState(view);
    const ui = await getUiState();
    expect(ui.collapsedProjects).toEqual(['/home/me/work']);
    expect(ui.filterCollapsedProjects).toEqual(['/home/me/other']);
    expect(ui.collapsedGroups).toEqual(['g1']);
    expect(ui.filterCollapsedGroups).toEqual(['g2']);
  });

  it('treats a zero width as never set, since it could not be dragged back', async () => {
    await setUiState({ ...view, sidebarWidth: 0, panelState: { sizes: { window: { sidebar: 0, main: 900 } }, collapsed: [], active: {} } });
    expect((await getUiState()).sidebarWidth).toBeNull();
    expect((await getUiState()).panelState.sizes).toEqual({ window: { main: 900 } });
  });

  it('normalizes on the way in too, so the renderer cannot store a shape the next launch chokes on', async () => {
    await setUiState({ ...view, scrollTop: -50 });
    expect((await getUiState()).scrollTop).toBe(0);
  });
});

describe('the live filter, renamed from running', () => {
  it('adopts the value stored under the old key', async () => {
    await writeMetaFile({ ui: { filters: { running: true } }, version: 3 });
    expect((await getUiState()).filters.live).toBe(true);
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ ui: { filters: { running: true, live: false } }, version: 3 });
    expect((await getUiState()).filters.live).toBe(false);
  });

  it('stops writing the old key back out', async () => {
    await writeMetaFile({ ui: { filters: { running: true } }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.ui.filters.running).toBeUndefined();
    expect(raw.ui.filters.live).toBe(true);
  });
});

describe('the finished filter, renamed from archived', () => {
  it('adopts the value stored under the old key', async () => {
    await writeMetaFile({ ui: { filters: { archived: true } }, version: 3 });
    expect((await getUiState()).filters.finished).toBe(true);
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ ui: { filters: { archived: true, finished: false } }, version: 3 });
    expect((await getUiState()).filters.finished).toBe(false);
  });

  it('stops writing the old key back out', async () => {
    await writeMetaFile({ ui: { filters: { archived: true } }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.ui.filters.archived).toBeUndefined();
    expect(raw.ui.filters.finished).toBe(true);
  });
});

describe('the set-aside filter, renamed from later', () => {
  it('adopts the value stored under the old key', async () => {
    await writeMetaFile({ ui: { filters: { later: true } }, version: 3 });
    expect((await getUiState()).filters.setAside).toBe(true);
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ ui: { filters: { later: true, setAside: false } }, version: 3 });
    expect((await getUiState()).filters.setAside).toBe(false);
  });

  it('stops writing the old key back out', async () => {
    await writeMetaFile({ ui: { filters: { later: true } }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.ui.filters.later).toBeUndefined();
    expect(raw.ui.filters.setAside).toBe(true);
  });
});

describe('the paused filter, which gave way to the set-aside one', () => {
  it('reads as off, and the set-aside pill with it, and is not written back out', async () => {
    await writeMetaFile({ ui: { filters: { paused: true } }, version: 3 });
    expect((await getUiState()).filters.setAside).toBe(false);
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.ui.filters.paused).toBeUndefined();
  });
});

describe('the PR filter, added after filters were first stored', () => {
  it('reads as off from a file stored before it, keeping the pills that file has on', async () => {
    await writeMetaFile({ ui: { filters: { pinned: true, siblings: true } }, version: 3 });
    const { filters } = await getUiState();
    expect(filters.prs).toBe(false);
    expect(filters.pinned).toBe(true);
    expect(filters.siblings).toBe(true);
  });
});

describe('a filter a stored file has no value for', () => {
  it('takes its default, so one that defaults to on does not read as off', async () => {
    defaultsWith.pinnedOn = true;
    try {
      await writeMetaFile({ ui: { filters: { siblings: true } }, version: 3 });
      const { filters } = await getUiState();
      expect(filters.pinned).toBe(true);
      expect(filters.siblings).toBe(true);
    } finally {
      defaultsWith.pinnedOn = false;
    }
  });
});
