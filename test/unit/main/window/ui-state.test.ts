import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { metaDir, useMetaDir, writeMetaFile } from '../sessions/meta-fixture';

vi.mock('electron', async () => (await import('../sessions/meta-fixture')).electronStub);

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

describe('the Editor', () => {
  it('starts as a drawer, drawing a diff Fit, whole and with whitespace', async () => {
    expect((await getUiState()).editor).toEqual({ docked: false, view: 'fit', ignoreWs: false, changesOnly: false });
  });

  it('gives each field that is missing or of the wrong kind its default, keeping the rest', async () => {
    await writeMetaFile({ ui: { editor: { docked: true, view: 'sideways', ignoreWs: 'yes' } }, version: 3 });
    expect((await getUiState()).editor).toEqual({ docked: true, view: 'fit', ignoreWs: false, changesOnly: false });
    await writeMetaFile({ ui: { editor: 'docked' }, version: 3 });
    expect((await getUiState()).editor).toEqual({ docked: false, view: 'fit', ignoreWs: false, changesOnly: false });
  });
});

describe('the history', () => {
  it('starts as a drawer, its docked width never set', async () => {
    expect((await getUiState()).history).toEqual({ docked: false, width: null });
  });

  it('gives each field that is missing or of the wrong kind its default, keeping the rest', async () => {
    await writeMetaFile({ ui: { history: { docked: true, width: 0 } }, version: 3 });
    expect((await getUiState()).history).toEqual({ docked: true, width: null });
    await writeMetaFile({ ui: { history: { docked: 'yes', width: 640 } }, version: 3 });
    expect((await getUiState()).history).toEqual({ docked: false, width: 640 });
    await writeMetaFile({ ui: { history: 'docked' }, version: 3 });
    expect((await getUiState()).history).toEqual({ docked: false, width: null });
  });
});

describe('ui state', () => {
  const view = {
    query: 'psalm is:pinned active:>=2026-11-01',
    finished: false,
    queryHelpOpen: true,
    tabBarExpanded: false,
    editor: { docked: true, view: 'split' as const, ignoreWs: true, changesOnly: true },
    history: { docked: true, width: 520 },
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
      query: '',
      finished: false,
      queryHelpOpen: false,
      tabBarExpanded: true,
      editor: { docked: false, view: 'fit', ignoreWs: false, changesOnly: false },
      history: { docked: false, width: null },
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

  it('fills in what an older meta.json never stored, and drops whether the filter panel was open, which is no longer kept', async () => {
    await writeMetaFile({ ui: { filterPanelOpen: true }, version: 3 });
    const ui = await getUiState();
    expect(ui).not.toHaveProperty('filterPanelOpen');
    expect(ui.query).toBe('');
    expect(ui.finished).toBe(false);
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
      ui: { query: 42, finished: 'yes', collapsedProjects: ['/a', 7, null], scrollTop: 'top' },
      version: 3,
    });
    const ui = await getUiState();
    expect(ui.query).toBe('');
    expect(ui.finished).toBe(false);
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

describe('a filter stored before the query field', () => {
  const query = async (ui: Record<string, unknown>): Promise<string> => {
    await writeMetaFile({ ui, version: 3 });
    return (await getUiState()).query;
  };

  it('reads its search and each pill on as the query, the search first', async () => {
    expect(await query({ search: ' fix login ', filters: { pinned: true, open: true, live: true, setAside: true, worktree: true, gone: true, siblings: true, prs: true, noted: true } })).toBe(
      'fix login is:pinned is:working is:running is:set-aside is:worktree is:gone is:sibling has:pr has:note',
    );
  });

  it('reads a pill stored under its older word, and the newer word where both are', async () => {
    expect(await query({ filters: { running: true, later: true } })).toBe('is:running is:set-aside');
    expect(await query({ filters: { running: true, live: false } })).toBe('');
  });

  it('reads a rolling date preset as its term, a custom range by its days, and an unknown preset as nothing', async () => {
    expect(await query({ datePreset: 'today' })).toBe('active:today');
    expect(await query({ datePreset: '7d' })).toBe('active:>=today-7d');
    expect(await query({ datePreset: '30d' })).toBe('active:>=today-30d');
    expect(await query({ datePreset: 'custom', dateFrom: new Date(2026, 8, 1).getTime(), dateTo: new Date(2026, 8, 30, 23, 59).getTime() })).toBe('active:>=2026-09-01 active:<=2026-09-30');
    expect(await query({ datePreset: 'yesterday' })).toBe('');
  });

  it('drops a pill that no longer exists', async () => {
    expect(await query({ filters: { paused: true, pinned: true } })).toBe('is:pinned');
  });

  it('reads the finished switch from where it was stored, under its older word too, the newest first', async () => {
    const finished = async (ui: Record<string, unknown>): Promise<boolean> => {
      await writeMetaFile({ ui, version: 3 });
      return (await getUiState()).finished;
    };
    expect(await finished({ filters: { finished: true } })).toBe(true);
    expect(await finished({ filters: { archived: true } })).toBe(true);
    expect(await finished({ finished: false, filters: { finished: true } })).toBe(false);
  });

  it('reads a query it has rather than the old fields beside it', async () => {
    expect(await query({ query: 'is:running', search: 'old', filters: { pinned: true } })).toBe('is:running');
  });

  it('stops writing the old fields once read', async () => {
    await writeMetaFile({ ui: { search: 'fix', filters: { pinned: true, archived: true }, datePreset: '7d', dateFrom: null, dateTo: null }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.ui.query).toBe('fix is:pinned active:>=today-7d');
    expect(raw.ui.finished).toBe(true);
    for (const old of ['search', 'filters', 'datePreset', 'dateFrom', 'dateTo']) expect(raw.ui[old]).toBeUndefined();
  });
});
