import { describe, it, expect } from 'vitest';
import {
  resolveLayout,
  validateEntry,
  fileWeights,
  foldEdge,
  isEmpty,
  mountSignature,
  parseSize,
  ID_PATTERN,
  DEFAULT_LAYOUT,
  DEFAULT_MIN,
  type LayoutView,
  type ResolvedGroup,
  type ResolvedNode,
  type ResolvedSplit,
} from '../../../../src/renderer/panels/layout';
import type { PanelTypeDecl } from '../../../../src/renderer/panels/contract';
import { commandType } from '../../../../src/renderer/panels/types/command';
import type { LayoutReport } from '../../../../src/shared/panels';

// The built-ins' declarations as the validator sees them; their mounts are the tree's business.
const sessions: PanelTypeDecl = { name: 'sessions', defaultTitle: () => 'Sessions', icon: 'sessions', bare: true, singleton: true };
const claude: PanelTypeDecl = { name: 'claude', defaultTitle: () => 'Claude', icon: 'claude', bare: true, singleton: true };
const TYPES = { sessions, claude, command: commandType };
const FILE = '/home/u/.config/claude-ui/config/layouts/default.json';

function report(json: unknown): LayoutReport {
  return { configRoot: '/home/u/.config/claude-ui/config', file: FILE, status: 'read', error: null, json, types: [] };
}

/** The two built-ins in their usual places, for a test about something else. */
const SIDEBAR = { id: 'sidebar', panels: [{ id: 'sessions', type: 'sessions' }] };
const CLAUDE = { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] };
/** A file whose root is columns of the built-ins with `extra` after them. */
function file(...extra: unknown[]): unknown {
  return { version: 2, root: { id: 'window', columns: [SIDEBAR, CLAUDE, ...extra] } };
}

function tree(view: LayoutView): ResolvedNode {
  expect(view.kind).toBe('tree');
  return (view as Extract<LayoutView, { kind: 'tree' }>).root;
}
function resolve(json: unknown): ResolvedNode {
  return tree(resolveLayout(report(json), TYPES));
}
function split(node: ResolvedNode): ResolvedSplit {
  expect(node.kind).toBe('split');
  return node as ResolvedSplit;
}
function group(node: ResolvedNode): ResolvedGroup {
  expect(node.kind).toBe('group');
  return node as ResolvedGroup;
}
/** The node after the two built-ins in a `file(...)` root. */
function third(json: unknown): ResolvedNode {
  return split(resolve(json)).children[2];
}
/** Every problem and note in the tree, with the id it is on: what a person reading the window would see. */
function said(node: ResolvedNode): string[] {
  const own = [...node.notes, ...(node.kind === 'group' ? [...node.problems, ...node.slots.flatMap((slot) => slot.problems)] : [])].map((line) => `${node.id}: ${line}`);
  return node.kind === 'split' ? [...own, ...node.children.flatMap(said)] : own;
}

describe('the default layout', () => {
  it('is what a missing file means, and resolves without a word said', () => {
    const root = split(tree(resolveLayout({ ...report(null), status: 'missing', json: null }, TYPES)));
    expect(said(root)).toEqual([]);
    expect(root).toMatchObject({ id: 'window', axis: 'columns' });
    expect(root.children.map((child) => child.id)).toEqual(['sidebar', 'claude']);
    // A fixed 320px beside a terminal that takes the rest: today's window, which does not widen the sidebar with the window.
    expect(group(root.children[0])).toMatchObject({ size: { px: 320 }, min: 220, bare: true, active: 'sessions' });
    expect(group(root.children[1])).toMatchObject({ size: null, min: DEFAULT_MIN, bare: true, active: 'cli' });
  });

  it('resolves the same written as a file', () => {
    expect(resolve(DEFAULT_LAYOUT)).toEqual(tree(resolveLayout({ ...report(null), status: 'missing', json: null }, TYPES)));
  });
});

describe('the file as a whole', () => {
  it('puts what is said about the config folder under the root, with or without a file, and beside the file’s own notes', () => {
    const note = 'types/command is not read: command is a type the app has built in.';
    expect(tree(resolveLayout({ ...report(null), status: 'missing', json: null }, TYPES, [note])).notes).toEqual([note]);
    const root = tree(resolveLayout(report({ version: 2, root: DEFAULT_LAYOUT.root, stray: 1 }), TYPES, [note]));
    expect(root.notes).toEqual(['stray is not a field the layout file has.', note]);
  });

  it('names the file and the parser’s position when it does not parse, so the last good layout can stay up', () => {
    const broken = { ...report(null), status: 'unparsable' as const, error: "Expected ',' or '}' after property value in JSON at position 32 (line 4 column 2)" };
    expect(resolveLayout(broken, TYPES)).toEqual({ kind: 'unparsable', file: FILE, message: broken.error });
  });

  it.each([
    [[], 'The file is not a JSON object.'],
    ['x', 'The file is not a JSON object.'],
    [{ root: {} }, 'version is missing (this build reads 2).'],
    [{ version: 1, sides: { right: { groups: [] } } }, 'version 1 is not one this build reads (it reads 2).'],
    [{ version: '2', root: {} }, 'version "2" is not one this build reads (it reads 2).'],
    [{ version: 2 }, 'root is missing.'],
  ])('keeps the default layout for %j and says why in one group beside it', (json, problem) => {
    const root = split(resolve(json));
    expect(root.children.map((child) => child.id)).toEqual(['sidebar', 'claude', '@layout']);
    expect(group(root.children[2])).toMatchObject({ title: 'default.json', size: { share: 0.25 }, problems: [problem], slots: [] });
  });

  it('names a field the file does not have, under the root', () => {
    expect(said(resolve({ ...(file() as object), sides: {} }))).toEqual(['window: sides is not a field the layout file has.']);
  });
});

describe('a node', () => {
  it('reads rows, columns and groups into splits and groups, in order', () => {
    const root = split(
      resolve({
        version: 2,
        root: { id: 'window', columns: [SIDEBAR, { id: 'main', rows: [CLAUDE, { id: 'drawer', panels: [{ id: 'status', type: 'command', options: { command: 'ls' } }] }] }] },
      }),
    );
    const main = split(root.children[1]);
    expect(main).toMatchObject({ id: 'main', axis: 'rows' });
    expect(main.children.map((child) => child.id)).toEqual(['claude', 'drawer']);
    expect(group(main.children[1]).slots.map((slot) => slot.key)).toEqual(['status']);
    expect(said(root)).toEqual([]);
  });

  it('reads size, min, resizable and collapsible, with their defaults', () => {
    const side = group(third(file({ id: 'side', size: 0.3, min: 200, resizable: false, collapsible: true, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] })));
    expect(side).toMatchObject({ size: { share: 0.3 }, min: 200, resizable: false, collapsible: true, problems: [] });
    const plain = group(third(file({ id: 'side', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] })));
    expect(plain).toMatchObject({ size: null, min: DEFAULT_MIN, resizable: true, collapsible: false });
  });

  it('reads a size in pixels', () => {
    const side = group(third(file({ id: 'side', size: '360px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] })));
    expect(side).toMatchObject({ size: { px: 360 }, notes: [], problems: [] });
    expect(group(third(file({ id: 'side', size: '180.5px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }))).size).toEqual({ px: 180.5 });
  });

  it('says so when a pixel size is below the min, which wins', () => {
    const side = group(third(file({ id: 'side', size: '100px', min: 200, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] })));
    expect(side.notes).toEqual(['size 100px is below min 200, so the node starts at 200px.']);
    expect(group(third(file({ id: 'side', size: '100px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }))).notes).toEqual([
      'size 100px is below min 120, so the node starts at 120px.',
    ]);
  });

  it.each([
    [{ panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'id is missing.'],
    [{ id: 7, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'id is not a string.'],
    [{ id: 'Side', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'id "Side" is not a slug (lowercase letters, digits, hyphens and underscores, starting with a letter or digit).'],
    [{ id: 'side' }, 'One of rows, columns or panels is required.'],
    [{ id: 'side', rows: [CLAUDE], panels: [] }, 'rows and panels are both given; give one.'],
    [{ id: 'side', rows: [], columns: [], panels: [] }, 'rows, columns and panels are all given; give one.'],
    [{ id: 'side', panels: {} }, 'panels is not an array.'],
    [{ id: 'side', panels: [] }, 'panels is empty.'],
    [{ id: 'side', rows: [] }, 'rows is empty.'],
    [{ id: 'side', columns: 'x' }, 'columns is not an array.'],
    [{ id: 'side', size: 0, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', size: '30%', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', size: -1, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', size: '0px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', size: '320 px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', size: 'px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', size: '0.3', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'size is not a positive number or a pixel size like "320px".'],
    [{ id: 'side', min: '200px', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'min is not a positive number of pixels.'],
    [{ id: 'side', min: 0, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'min is not a positive number of pixels.'],
    [{ id: 'side', resizable: 'no', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'resizable is not true or false.'],
    [{ id: 'side', collapsible: 1, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'collapsible is not true or false.'],
    [{ id: 'side', colapsible: true, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'colapsible is not a field a node has.'],
    [{ id: 'side', type: 'command', options: { command: 'ls' } }, 'This looks like a panel entry; entries go in a group’s panels.'],
    [{ id: 'side', active: 'b', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'active "b" is not one of this group’s panels.'],
    [{ id: 'side', active: 'sessions', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'active "sessions" is not one of this group’s panels.'],
    [{ id: 'side', active: 'a', panels: [{ id: 'a', type: 'command', options: { command: 'ls' }, hidden: true }] }, 'active "a" is hidden.'],
    [{ id: 'side', active: 3, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }, 'active is not a string.'],
    [{ id: 'side', active: 'a', rows: [{ id: 'x', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] }, 'active is for a group of panels; this node has rows.'],
  ])('degrades %j in its place, saying: %s', (node, problem) => {
    const degraded = group(third(file(node)));
    expect(degraded.problems).toContain(problem);
    expect(degraded.slots).toEqual([]);
  });

  it('refuses a node that is not an object, and calls it by where it is', () => {
    expect(group(third(file('side')))).toMatchObject({ id: '#root.2', title: 'column 3 of window', problems: ['The node is not an object.'] });
  });

  it('titles a degraded node by its id as written, or by where it is without one', () => {
    expect(group(third(file({ id: 'Side', panels: [] }))).title).toBe('Side');
    expect(group(third(file({ panels: [] })))).toMatchObject({ id: '#root.2', title: 'column 3 of window' });
  });

  it('collects every problem with a node, not only the first', () => {
    expect(group(third(file({ id: 'side', size: 'big', colapsible: true }))).problems).toEqual([
      'colapsible is not a field a node has.',
      'One of rows, columns or panels is required.',
      'size is not a positive number or a pixel size like "320px".',
    ]);
  });

  it('keeps a degraded node where the node was: its readable size and min still hold', () => {
    expect(group(third(file({ id: 'side', size: 0.3, min: 200, resizable: false, panels: [] })))).toMatchObject({ size: { share: 0.3 }, min: 200, resizable: false });
    expect(group(third(file({ id: 'side', size: '300px', panels: [] }))).size).toEqual({ px: 300 });
  });

  it('names collapsible on rows or columns as not honoured yet, and still draws them', () => {
    const node = split(third(file({ id: 'more', collapsible: true, rows: [{ id: 'x', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] })));
    expect(node.notes).toEqual(['collapsible is not honoured on rows or columns yet; only a group folds.']);
    expect(node.children).toHaveLength(1);
  });
});

describe('one id namespace', () => {
  it('names a node that reuses an entry’s id, and an entry that reuses a node’s', () => {
    expect(group(third(file({ id: 'cli', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }))).problems).toEqual([
      'id "cli" is already used earlier in the file.',
    ]);
    const slot = group(third(file({ id: 'side', panels: [{ id: 'window', type: 'command', options: { command: 'ls' } }] }))).slots[0];
    expect(slot.problems).toEqual(['id "window" is already used earlier in the file.']);
  });

  it('keys an entry without a usable id by its position, unique across groups, so state cannot land on another', () => {
    const root = split(
      resolve(
        file(
          { id: 'one', panels: [{ type: 'command', options: { command: 'ls' } }] },
          { id: 'two', panels: [{ type: 'command', options: { command: 'ls' } }] },
        ),
      ),
    );
    expect(group(root.children[2]).slots[0].key).toBe('one/0');
    expect(group(root.children[3]).slots[0].key).toBe('two/0');
  });
});

describe('a group', () => {
  const panels = [
    { id: 'a', type: 'command', options: { command: 'ls' }, hidden: true },
    { id: 'b', type: 'command', options: { command: 'pwd' } },
    { id: 'c', type: 'command', options: { command: 'ls' } },
  ];

  it('shows the first panel that is not hidden, or the one the file names', () => {
    expect(group(third(file({ id: 'side', panels }))).active).toBe('b');
    expect(group(third(file({ id: 'side', panels, active: 'c' }))).active).toBe('c');
  });

  it('takes no room when every panel is hidden, and neither does a split of such groups', () => {
    const hidden = { id: 'side', panels: [{ id: 'a', type: 'command', options: { command: 'ls' }, hidden: true }] };
    const node = third(file(hidden));
    expect(group(node).active).toBeNull();
    expect(isEmpty(node)).toBe(true);
    expect(isEmpty(third(file({ id: 'more', rows: [hidden] })))).toBe(true);
    expect(isEmpty(third(file({ id: 'side', panels })))).toBe(false);
  });

  it('always shows a degraded group, which has no panels to hide', () => {
    expect(isEmpty(third(file({ id: 'side', panels: [] })))).toBe(false);
  });

  it('is bare only for one built-in on show alone', () => {
    const root = split(resolve(file()));
    expect(group(root.children[0]).bare).toBe(true);
    expect(group(third(file({ id: 'side', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }))).bare).toBe(false);
    const shared = { version: 2, root: { id: 'window', columns: [SIDEBAR, { id: 'main', panels: [{ id: 'cli', type: 'claude' }, { id: 'a', type: 'command', options: { command: 'ls' } }] }] } };
    expect(group(split(resolve(shared)).children[1]).bare).toBe(false);
    const alone = { version: 2, root: { id: 'window', columns: [SIDEBAR, { id: 'main', panels: [{ id: 'cli', type: 'claude' }, { id: 'a', type: 'command', options: { command: 'ls' }, hidden: true }] }] } };
    expect(group(split(resolve(alone)).children[1]).bare).toBe(true);
  });
});

describe('the built-ins', () => {
  it('adds claude as the root’s last column when the file leaves it out, and says so there', () => {
    const root = split(resolve({ version: 2, root: { id: 'window', columns: [SIDEBAR, { id: 'side', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] } }));
    expect(root.id).toBe('window');
    expect(root.children.map((child) => child.id)).toEqual(['sidebar', 'side', '@claude']);
    expect(group(root.children[2])).toMatchObject({ active: '@cli', bare: true, notes: ['The layout does not place the claude panel, so it is added here.'] });
    expect(group(root.children[2]).slots[0]).toMatchObject({ key: '@cli', type: 'claude', problems: [] });
  });

  it('adds sessions as the first column, at the default layout’s size', () => {
    const root = split(resolve({ version: 2, root: { id: 'window', columns: [CLAUDE] } }));
    expect(root.children.map((child) => child.id)).toEqual(['@sidebar', 'claude']);
    expect(group(root.children[0])).toMatchObject({ size: { px: 320 }, min: 220, notes: ['The layout does not place the sessions panel, so it is added here.'] });
  });

  it('wraps a root that is rows, or a group, in columns to add them beside it', () => {
    const rows = split(resolve({ version: 2, root: { id: 'main', rows: [CLAUDE, { id: 'drawer', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] } }));
    expect(rows).toMatchObject({ id: '@window', axis: 'columns' });
    expect(rows.children.map((child) => child.id)).toEqual(['@sidebar', 'main']);
    const single = split(resolve({ version: 2, root: { id: 'only', panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] } }));
    expect(single.children.map((child) => child.id)).toEqual(['@sidebar', 'only', '@claude']);
  });

  it('adds both around a root that is itself degraded', () => {
    const root = split(resolve({ version: 2, root: { id: 'window' } }));
    expect(root.children.map((child) => child.id)).toEqual(['@sidebar', 'window', '@claude']);
    expect(group(root.children[1]).problems).toEqual(['One of rows, columns or panels is required.']);
  });

  it('adds one that sits inside a degraded node, since that node draws nothing it holds', () => {
    const root = split(resolve(file({ id: 'more', size: 'x', rows: [{ id: 'twice', panels: [{ id: 'cli2', type: 'claude' }] }] })));
    expect(root.children.map((child) => child.id)).toEqual(['sidebar', 'claude', 'more']);
  });

  it('adds one whose only entry has a problem, and leaves that entry saying what it is', () => {
    const root = split(resolve({ version: 2, root: { id: 'window', columns: [SIDEBAR, { id: 'claude', panels: [{ id: 'cli', type: 'claude', title: 3 }] }] } }));
    expect(root.children.map((child) => child.id)).toEqual(['sidebar', 'claude', '@claude']);
    expect(group(root.children[1]).slots[0].problems).toEqual(['title is not a string.']);
  });

  it('refuses a second copy in its place, naming where the first is', () => {
    const slot = group(third(file({ id: 'again', panels: [{ id: 'cli2', type: 'claude' }] }))).slots[0];
    expect(slot.problems).toEqual(['type claude is already placed as "cli".']);
  });

  it('ignores hidden on a built-in and says so, since the window needs it', () => {
    const root = split(resolve({ version: 2, root: { id: 'window', columns: [SIDEBAR, { id: 'claude', panels: [{ id: 'cli', type: 'claude', hidden: true }] }] } }));
    expect(root.children).toHaveLength(2);
    const claudeGroup = group(root.children[1]);
    expect(claudeGroup.slots[0].hidden).toBe(false);
    expect(claudeGroup.active).toBe('cli');
    expect(claudeGroup.notes).toEqual(['hidden is ignored on cli: the claude panel cannot be hidden.']);
  });
});

describe('sizes', () => {
  it('lets the unsized share what the sized leave, and reads sizes on every child as proportions', () => {
    expect(fileWeights([0.22, null]).weights[1]).toBeCloseTo(0.78);
    expect(fileWeights([0.2, null, null]).weights).toEqual([0.2, 0.4, 0.4]);
    expect(fileWeights([2, 1])).toEqual({ weights: [2, 1], exhausted: false });
    expect(fileWeights([null, null])).toEqual({ weights: [0.5, 0.5], exhausted: false });
  });

  it('weights the unsized as the average when the sized leave nothing, and says so', () => {
    expect(fileWeights([0.6, 0.6, null])).toEqual({ weights: [0.6, 0.6, 0.6], exhausted: true });
    const root = split(resolve(file({ id: 'a', size: 0.5, panels: [{ id: 'x', type: 'command', options: { command: 'ls' } }] }, { id: 'b', size: 0.6, panels: [{ id: 'y', type: 'command', options: { command: 'ls' } }] })));
    expect(root.notes).toEqual(['The sizes in window add up to 1.1, which leaves nothing for sidebar, claude; each is sized as their average.']);
  });

  it('leaves pixel children out of the shares, since the shares divide what they leave', () => {
    const fixed = { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] };
    const root = split(resolve({ version: 2, root: { id: 'window', columns: [fixed, CLAUDE, { id: 'side', size: 0.3, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] } }));
    expect(root.notes).toEqual([]);
    const full = { version: 2, root: { id: 'window', columns: [fixed, CLAUDE, { id: 'side', size: 1, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] } };
    expect(split(resolve(full)).notes).toEqual(['The sizes in window add up to 1, which leaves nothing for claude; it is sized as their average.']);
  });

  it('checks the sizes after a built-in is added, since the added one is unsized', () => {
    const sized = { id: 'sidebar', size: 0.5, panels: [{ id: 'sessions', type: 'sessions' }] };
    const root = split(resolve({ version: 2, root: { id: 'window', columns: [sized, { id: 'side', size: 0.5, panels: [{ id: 'a', type: 'command', options: { command: 'ls' } }] }] } }));
    expect(root.children.map((child) => child.id)).toEqual(['sidebar', 'side', '@claude']);
    expect(root.notes).toEqual(['The sizes in window add up to 1, which leaves nothing for @claude; it is sized as their average.']);
  });
});

describe('one entry', () => {
  const entry = (raw: unknown, seen = new Set<string>()) => validateEntry(raw, 0, TYPES, seen);

  it('accepts a command line, titled by the line', () => {
    const slot = entry({ id: 'status', type: 'command', options: { command: 'git status --short' } });
    expect(slot).toMatchObject({ key: 'status', type: 'command', title: 'git status --short', problems: [], hidden: false });
  });

  it('accepts a script, titled by its file name, without looking for it: that is the panel’s to do', () => {
    const slot = entry({ id: 'status', type: 'command', options: { script: 'scripts/nowhere.sh' } });
    expect(slot).toMatchObject({ key: 'status', title: 'nowhere.sh', problems: [] });
  });

  it('prefers a given title and cuts a long default one', () => {
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' }, title: 'Files' }).title).toBe('Files');
    const long = 'git log --oneline --graph --decorate --all --since=yesterday';
    // 40 characters including the ellipsis.
    expect(entry({ id: 'a', type: 'command', options: { command: long } }).title).toBe('git log --oneline --graph --decorate --…');
  });

  it('titles an entry by its id when its options give no title, since they are not checked yet', () => {
    expect(entry({ id: 'status', type: 'command' }).title).toBe('status');
    expect(entry({ id: 'status', type: 'command', options: { command: 7 } }).title).toBe('status');
    expect(entry({ id: 'status', type: 'command', options: { command: '  ' } }).title).toBe('status');
  });

  it('refuses nothing inside options: what is wrong there is the type’s to say, once it is mounted', () => {
    for (const options of [{}, { command: 'ls', script: 'x.sh' }, { command: 7 }, { comand: 'ls' }]) {
      expect(entry({ id: 'a', type: 'command', options }).problems).toEqual([]);
    }
  });

  it('names a setting written beside options rather than in them, without knowing any type’s options', () => {
    expect(entry({ id: 'a', type: 'command', command: 'ls' }).problems).toEqual(['command is not a field of a panel entry; a type’s own settings go under options.']);
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' }, tilte: 'x' }).problems).toEqual([
      'tilte is not a field of a panel entry; a type’s own settings go under options.',
    ]);
  });

  it.each([
    [{ type: 'command', options: { command: 'ls' } }, 'id is missing.'],
    [{ id: 4, type: 'command', options: { command: 'ls' } }, 'id is not a string.'],
    [{ id: 'Status', type: 'command', options: { command: 'ls' } }, 'id "Status" is not a slug (lowercase letters, digits, hyphens and underscores, starting with a letter or digit).'],
    [{ id: '-x', type: 'command', options: { command: 'ls' } }, 'id "-x" is not a slug (lowercase letters, digits, hyphens and underscores, starting with a letter or digit).'],
    [{ id: 'a b', type: 'command', options: { command: 'ls' } }, 'id "a b" is not a slug (lowercase letters, digits, hyphens and underscores, starting with a letter or digit).'],
    [{ id: 'a', options: { command: 'ls' } }, 'type is missing.'],
    [{ id: 'a', type: 3, options: { command: 'ls' } }, 'type is not a string.'],
    [{ id: 'a', type: 'comand', options: { command: 'ls' } }, 'type "comand" is not a type this build knows (it knows: sessions, claude, command).'],
    [{ id: 'a', type: 'command', options: { command: 'ls' }, title: 1 }, 'title is not a string.'],
    [{ id: 'a', type: 'command', options: { command: 'ls' }, hidden: 'yes' }, 'hidden is not true or false.'],
    [{ id: 'a', type: 'command', options: 'ls' }, 'options is not an object.'],
    [{ id: 'a', type: 'command', options: ['ls'] }, 'options is not an object.'],
    [{ id: 'a', type: 'command', options: null }, 'options is not an object.'],
  ])('refuses %j: %s', (raw, problem) => {
    expect(entry(raw).problems).toContain(problem);
  });

  it('refuses the name of something every object has, rather than taking it for a type', () => {
    for (const type of ['toString', 'constructor', '__proto__']) {
      expect(entry({ id: 'a', type }).problems).toEqual([`type "${type}" is not a type this build knows (it knows: sessions, claude, command).`]);
    }
  });

  it('refuses the second use of an id, and keys the slot by position so state cannot land on the first', () => {
    const seen = new Set<string>();
    const first = validateEntry({ id: 'a', type: 'command', options: { command: 'ls' } }, 0, TYPES, seen);
    const second = validateEntry({ id: 'a', type: 'command', options: { command: 'pwd' } }, 1, TYPES, seen);
    expect(first.problems).toEqual([]);
    expect(second.problems).toEqual(['id "a" is already used earlier in the file.']);
    expect(second.key).toBe('#1');
  });

  it('collects every problem, not only the first', () => {
    expect(entry({ id: 'A', type: 'nope' }).problems).toEqual([
      'id "A" is not a slug (lowercase letters, digits, hyphens and underscores, starting with a letter or digit).',
      'type "nope" is not a type this build knows (it knows: sessions, claude, command).',
    ]);
  });

  it('names an entry that is not an object at all', () => {
    expect(entry('git status')).toMatchObject({ key: '#0', type: null, title: 'Entry 1', problems: ['The entry is not an object.'], entry: null });
  });

  it('keeps a degraded entry’s id as its title, so the message says which entry it is about', () => {
    expect(entry({ id: 'status', type: 'command' }).title).toBe('status');
  });

  it('honours hidden, and only true', () => {
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' }, hidden: true }).hidden).toBe(true);
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' }, hidden: false }).hidden).toBe(false);
  });

  it('wears its type’s icon, or the one it names', () => {
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' } })).toMatchObject({ icon: 'command', notes: [] });
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' }, icon: 'git' })).toMatchObject({ icon: 'git', notes: [] });
  });

  it('names an icon this build does not have and wears its type’s, since an icon is no reason to refuse a panel', () => {
    const slot = entry({ id: 'deploy', type: 'command', options: { command: 'ls' }, icon: 'rocket' });
    expect(slot.problems).toEqual([]);
    expect(slot.icon).toBe('command');
    expect(slot.notes).toHaveLength(1);
    expect(slot.notes[0]).toMatch(/^icon "rocket" on deploy is not an icon this build has \(it has: sessions, claude, command, terminal, git, .*\); the command icon is used\.$/);
    expect(entry({ id: 'a', type: 'command', options: { command: 'ls' }, icon: 3 }).notes).toEqual(['icon on a is not a string; the command icon is used.']);
  });

  it('wears the alert icon when it cannot run, whatever it names', () => {
    expect(entry({ id: 'a', type: 'nope', icon: 'git' }).icon).toBe('alert');
    expect(entry('git status').icon).toBe('alert');
    const twice = group(third(file({ id: 'again', panels: [{ id: 'cli2', type: 'claude' }] }))).slots[0];
    expect(twice.icon).toBe('alert');
  });
});

describe('mountSignature', () => {
  const slot = (raw: Record<string, unknown>) => validateEntry(raw, 0, TYPES, new Set());
  const base = { id: 'status', type: 'command', options: { command: 'git status --short', cwd: '~/x' } };

  it('stays the same when only the title, the icon or hidden change, so the panel is moved rather than restarted', () => {
    const before = mountSignature(slot(base));
    expect(mountSignature(slot({ ...base, title: 'Status' }))).toBe(before);
    expect(mountSignature(slot({ ...base, icon: 'git' }))).toBe(before);
    expect(mountSignature(slot({ ...base, hidden: false }))).toBe(before);
  });

  it('stays the same when the options are only reordered in the file', () => {
    expect(mountSignature(slot({ ...base, options: { cwd: '~/x', command: 'git status --short' } }))).toBe(mountSignature(slot(base)));
  });

  it('changes with anything under options, or the type, so the panel is mounted afresh — without knowing which options a type has', () => {
    const before = mountSignature(slot(base));
    expect(mountSignature(slot({ ...base, options: { ...base.options, command: 'git status' } }))).not.toBe(before);
    expect(mountSignature(slot({ ...base, options: { ...base.options, later: true } }))).not.toBe(before);
    expect(mountSignature(slot({ id: 'status', type: 'command', options: { script: 'git status --short' } }))).not.toBe(before);
    expect(mountSignature(slot({ id: 'status', type: 'sessions' }))).not.toBe(before);
  });

  it('changes with what the type was built from, so an edited manifest mounts its panels afresh', () => {
    expect(mountSignature(slot(base), 'manifest v2')).not.toBe(mountSignature(slot(base), 'manifest v1'));
    expect(mountSignature(slot(base), 'manifest v1')).toBe(mountSignature(slot(base), 'manifest v1'));
  });
});

describe('foldEdge', () => {
  const px = { size: { px: 300 } };
  const share = { size: { share: 0.3 } };
  const free = { size: null };

  it('folds the first child to the start and the last to the end, each having one divider', () => {
    expect(foldEdge([px, free], 0)).toBe('start');
    expect(foldEdge([free, px], 1)).toBe('end');
    // Even where the space goes the other way: the chevron has nowhere else to sit.
    expect(foldEdge([px, px], 1)).toBe('end');
  });

  it('folds a middle child to the end when all its space goes to siblings before it', () => {
    // The two-neighbours case: Claude (unsized) before `notes`, a pixel column after it.
    expect(foldEdge([px, free, px, px], 2)).toBe('end');
    expect(foldEdge([share, px, px], 1)).toBe('end');
  });

  it('folds a middle child to the start when its space goes to siblings after it, both ways, or nowhere', () => {
    expect(foldEdge([px, px, free], 1)).toBe('start');
    expect(foldEdge([free, px, share], 1)).toBe('start');
    expect(foldEdge([px, px, px], 1)).toBe('start');
  });

  it('counts a middle child’s own size for nothing, only its siblings’', () => {
    expect(foldEdge([free, free, px], 1)).toBe('end');
    expect(foldEdge([free, px, px], 1)).toBe('end');
  });

  it('gives two foldable children alone in a split one divider between them, from both sides', () => {
    expect([foldEdge([px, px], 0), foldEdge([px, px], 1)]).toEqual(['start', 'end']);
  });

  it('folds a child alone to the start, though with no divider it cannot fold', () => {
    expect(foldEdge([px], 0)).toBe('start');
  });
});

describe('parseSize', () => {
  it.each([
    [0.25, { share: 0.25 }],
    [2, { share: 2 }],
    ['320px', { px: 320 }],
    ['12.5px', { px: 12.5 }],
  ])('reads %j', (value, size) => expect(parseSize(value)).toEqual(size));
  it.each([0, -1, Infinity, '0.3', '30%', '320', '320 px', ' 320px', '0px', 'px', '-5px', null, true, {}])('refuses %j', (value) =>
    expect(parseSize(value)).toBeNull(),
  );
});

describe('ID_PATTERN', () => {
  it.each(['a', 'status', 'git-status-2', '0x', 'a_b', 'review_queue'])('accepts %s', (id) => expect(ID_PATTERN.test(id)).toBe(true));
  it.each(['', 'A', '-a', '_a', 'a.b', 'a b', 'é', '@cli', '#0'])('refuses %j', (id) => expect(ID_PATTERN.test(id)).toBe(false));
});
