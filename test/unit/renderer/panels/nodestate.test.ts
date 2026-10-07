import { describe, it, expect } from 'vitest';
import { defaultUi } from '../../../../src/shared/defaults';
import type { LayoutReport, PanelState } from '../../../../src/shared/panels';
import { resolveLayout, type ResolvedNode } from '../../../../src/renderer/panels/layout';
import { idsIn, readNodeState, stateFromPanelState } from '../../../../src/renderer/panels/nodestate';
import { commandType } from '../../../../src/renderer/panels/types/command';
import type { PanelTypeDecl } from '../../../../src/renderer/panels/contract';

const FILE = 'default.local.json';
const sessions: PanelTypeDecl = { name: 'sessions', defaultTitle: () => 'Sessions', icon: 'sessions', bare: true, singleton: true };
const claude: PanelTypeDecl = { name: 'claude', defaultTitle: () => 'Claude', icon: 'claude', bare: true, singleton: true };

/** A tree as the window resolves it from `json`, or the default layout without one. */
function tree(json: unknown = null): ResolvedNode {
  const report: LayoutReport = {
    configRoot: '/cfg',
    file: '/cfg/layouts/default.json',
    status: json === null ? 'missing' : 'read',
    error: null,
    json,
    types: [],
    local: { file: '', status: 'missing', error: null, json: null, byApp: false, stateMoved: true },
  };
  const view = resolveLayout(report, { sessions, claude, command: commandType });
  if (view.kind !== 'tree') throw new Error('not a tree');
  return view.root;
}

const command = (id: string): object => ({ id, type: 'command', options: { command: 'ls' } });
const LAYOUT = {
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', collapsible: true, panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'main', rows: [{ id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }, { id: 'drawer', size: 0.3, panels: [command('shell')] }] },
      { id: 'right', size: '360px', collapsible: true, panels: [command('status'), command('checks')] },
    ],
  },
};

const legacy = (state: Partial<PanelState>): PanelState => ({ ...defaultUi().panelState, ...state });

describe('readNodeState', () => {
  it('takes in what the file keeps for each node', () => {
    expect(readNodeState({ nodes: { sidebar: { size: '280px' }, right: { folded: true, active: 'checks' } } }, FILE)).toEqual({
      state: { sidebar: { size: '280px' }, right: { folded: true, active: 'checks' } },
      notes: {},
      fileNotes: [],
    });
  });

  it('is empty for a file that is not there', () => {
    expect(readNodeState(null, FILE)).toEqual({ state: {}, notes: {}, fileNotes: [] });
  });

  it('names a field it does not keep, and a value a field may not hold, under the node, keeping the rest', () => {
    const read = readNodeState({ nodes: { right: { folded: 'yes', active: 'checks', colour: 'red' } } }, FILE);
    expect(read.state).toEqual({ right: { active: 'checks' } });
    expect(read.notes.right).toEqual(['default.local.json: folded is not true or false.', 'default.local.json: colour is not something the app keeps for a node.']);
  });

  it('names what is wrong with the file as a whole', () => {
    expect(readNodeState([1], FILE).fileNotes).toEqual(['default.local.json has to hold one object, { "nodes": { … } }, so none of it is used.']);
    expect(readNodeState({ nodes: 3, extra: 1 }, FILE).fileNotes).toEqual(['default.local.json: "extra" is not something the app keeps.', 'default.local.json: nodes is not an object, so none of it is used.']);
    expect(readNodeState({ nodes: { right: 'folded' } }, FILE).notes.right).toEqual(['default.local.json: what it keeps for right is not an object.']);
  });
});

describe('idsIn', () => {
  it('holds every node and slot of the tree', () => {
    expect([...idsIn(tree(LAYOUT))].sort()).toEqual(['checks', 'claude', 'cli', 'drawer', 'main', 'right', 'sessions', 'shell', 'sidebar', 'status', 'window'].sort());
  });
});

describe('stateFromPanelState', () => {
  it('turns a split’s dragged px into pixels for a pixel child, writing only what differs from the file, and leaves a lone flexible child unwritten', () => {
    const state = stateFromPanelState(tree(LAYOUT), legacy({ sizes: { window: { sidebar: 280, main: 900, right: 360 } } }), null, 1600);
    expect(state).toEqual({ sidebar: { size: '280px' } });
  });

  it('turns flexible children’s px into shares of what they shared, which shows the same', () => {
    const state = stateFromPanelState(tree(LAYOUT), legacy({ sizes: { main: { claude: 600, drawer: 200 } } }), null, 1600);
    expect(state).toEqual({ claude: { size: 0.75 }, drawer: { size: 0.25 } });
  });

  it('drops a split’s px that do not name every one of its children, as they always were', () => {
    expect(stateFromPanelState(tree(LAYOUT), legacy({ sizes: { window: { sidebar: 280, main: 900 } } }), null, 1600)).toEqual({});
    expect(stateFromPanelState(tree(LAYOUT), legacy({ sizes: { window: { sidebar: 280, main: 900, right: 400, gone: 10 } } }), null, 1600)).toEqual({});
  });

  it('keeps a fold of a group that can fold, and a pick of a panel the group has, where each differs from the file', () => {
    const state = stateFromPanelState(tree(LAYOUT), legacy({ collapsed: ['right', 'drawer'], active: { right: 'checks', drawer: 'shell', sidebar: 'nope' } }), null, 1600);
    expect(state).toEqual({ right: { folded: true, active: 'checks' } });
  });

  it('moves the sidebar’s width from before it was a node into the default layout, and ignores one it could not have been dragged to', () => {
    expect(stateFromPanelState(tree(), legacy({}), 300, 1600)).toEqual({ sidebar: { size: '300px' } });
    expect(stateFromPanelState(tree(), legacy({}), 100, 1600)).toEqual({});
    expect(stateFromPanelState(tree(), legacy({}), 2000, 1600)).toEqual({});
  });
});
