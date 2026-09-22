import { describe, it, expect } from 'vitest';
import { resolveLayout, validateEntry, ID_PATTERN, type LayoutView } from './layout';
import { commandType } from './types/command';
import type { LayoutReport, ScriptCheck } from '../../shared/panels';

const TYPES = { command: commandType };
const FILE = '/home/u/.config/claude-ui/config/layouts/default.json';

function report(json: unknown, scripts: Record<string, ScriptCheck> = {}): LayoutReport {
  return { configRoot: '/home/u/.config/claude-ui/config', file: FILE, status: 'read', error: null, json, scripts };
}
/** A file with the given entries in the first group on the right, which is what this build reads. */
function layout(panels: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { version: 1, sides: { right: { groups: [{ panels }] } }, ...extra };
}
const ok: ScriptCheck = { path: '/home/u/.config/claude-ui/config/scripts/status.sh', problem: null };

function shown(view: LayoutView): Extract<LayoutView, { kind: 'panel' }> {
  expect(view.kind).toBe('panel');
  return view as Extract<LayoutView, { kind: 'panel' }>;
}

describe('the file as a whole', () => {
  it('shows nothing when there is no file', () => {
    expect(resolveLayout({ ...report(null), status: 'missing', json: null }, TYPES)).toEqual({ kind: 'empty' });
  });

  it('names the file and the parser’s position when it does not parse, so the last good layout can stay up', () => {
    const broken = { ...report(null), status: 'unparsable' as const, error: "Expected ',' or '}' after property value in JSON at position 32 (line 4 column 2)" };
    expect(resolveLayout(broken, TYPES)).toEqual({ kind: 'unparsable', file: FILE, message: broken.error });
  });

  it.each([
    [[], 'The file is not a JSON object.'],
    ['x', 'The file is not a JSON object.'],
    [{ sides: {} }, 'version is missing (this build reads 1).'],
    [{ version: 2, sides: {} }, 'version 2 is not one this build reads (it reads 1).'],
    [{ version: '1', sides: {} }, 'version "1" is not one this build reads (it reads 1).'],
    [{ version: 1 }, 'sides is missing.'],
    [{ version: 1, sides: [] }, 'sides is not an object.'],
    [{ version: 1, sides: { right: 3 } }, 'sides.right is not an object.'],
    [{ version: 1, sides: { right: {} } }, 'sides.right.groups is not an array.'],
    [{ version: 1, sides: { right: { groups: [7] } } }, 'The first group on the right is not an object.'],
    [{ version: 1, sides: { right: { groups: [{}] } } }, 'The first group on the right has no panels array.'],
  ])('degrades %j, saying exactly what', (json, problem) => {
    expect(resolveLayout(report(json), TYPES)).toEqual({ kind: 'degraded', problems: [problem] });
  });

  it('shows nothing for a right side with no groups, or with no panel that is not hidden', () => {
    expect(resolveLayout(report({ version: 1, sides: {} }), TYPES)).toEqual({ kind: 'empty' });
    expect(resolveLayout(report({ version: 1, sides: { right: { groups: [] } } }), TYPES)).toEqual({ kind: 'empty' });
    expect(resolveLayout(report(layout([{ id: 'a', type: 'command', command: 'ls', hidden: true }])), TYPES)).toEqual({ kind: 'empty' });
  });

  it('names a side this build does not show, even when that leaves nothing to show', () => {
    const bottomOnly = { version: 1, sides: { bottom: { groups: [] } } };
    expect(resolveLayout(report(bottomOnly), TYPES)).toEqual({
      kind: 'degraded',
      problems: ['Only the right side is shown yet; this file also has bottom.'],
    });
    const both = { version: 1, sides: { right: { groups: [{ panels: [{ id: 'a', type: 'command', command: 'ls' }] }] }, left: {} } };
    expect(shown(resolveLayout(report(both), TYPES)).notShown).toEqual(['Only the right side is shown yet; this file also has left.']);
  });

  it('reads the side’s share of the window, and names a share it cannot read', () => {
    const one = [{ id: 'a', type: 'command', command: 'ls' }];
    expect(shown(resolveLayout(report(layout(one)), TYPES)).sideSize).toBeNull();
    const sized = { version: 1, sides: { right: { size: 0.3, groups: [{ panels: one }] } } };
    expect(shown(resolveLayout(report(sized), TYPES)).sideSize).toBe(0.3);
    for (const size of ['30%', 0, 1.5, -1]) {
      const view = shown(resolveLayout(report({ version: 1, sides: { right: { size, groups: [{ panels: one }] } } }), TYPES));
      expect(view.sideSize).toBeNull();
      expect(view.notShown).toEqual(['sides.right.size is not a number between 0 and 1; the default width is used.']);
    }
  });

  it('shows the first non-hidden entry of the first group and names the rest', () => {
    const view = shown(
      resolveLayout(
        report({
          version: 1,
          sides: {
            right: {
              groups: [
                { panels: [{ id: 'a', type: 'command', command: 'ls', hidden: true }, { id: 'b', type: 'command', command: 'pwd' }, { id: 'c', type: 'command', command: 'ls' }] },
                { panels: [] },
                { panels: [] },
              ],
            },
          },
        }),
        TYPES,
      ),
    );
    expect(view.slot.key).toBe('b');
    expect(view.slot.problems).toEqual([]);
    expect(view.notShown).toEqual([
      'Only the first group is shown yet; the right side has 2 more groups.',
      'Only one panel is shown yet; this group also has c.',
    ]);
  });
});

describe('one entry', () => {
  const entry = (raw: unknown, scripts: Record<string, ScriptCheck> = {}, seen = new Set<string>()) =>
    validateEntry(raw, 0, TYPES, report(null, scripts), seen);

  it('accepts a command line, titled by the line', () => {
    const slot = entry({ id: 'status', type: 'command', command: 'git status --short' });
    expect(slot).toMatchObject({ key: 'status', type: 'command', title: 'git status --short', problems: [], hidden: false });
  });

  it('accepts a script that checked out, titled by its file name', () => {
    const slot = entry({ id: 'status', type: 'command', script: 'scripts/status.sh' }, { 'scripts/status.sh': ok });
    expect(slot).toMatchObject({ key: 'status', title: 'status.sh', problems: [] });
  });

  it('prefers a given title and cuts a long default one', () => {
    expect(entry({ id: 'a', type: 'command', command: 'ls', title: 'Files' }).title).toBe('Files');
    const long = 'git log --oneline --graph --decorate --all --since=yesterday';
    // 40 characters including the ellipsis.
    expect(entry({ id: 'a', type: 'command', command: long }).title).toBe('git log --oneline --graph --decorate --…');
  });

  it('carries the script’s own problem into the entry, in the value as written', () => {
    const missing = { 'scripts/status.sh': { path: '/x/scripts/status.sh', problem: 'scripts/status.sh not found' } };
    expect(entry({ id: 'a', type: 'command', script: 'scripts/status.sh' }, missing).problems).toEqual(['scripts/status.sh not found.']);
    const mode = { 'scripts/status.sh': { path: '/x/scripts/status.sh', problem: 'scripts/status.sh is not executable' } };
    expect(entry({ id: 'a', type: 'command', script: 'scripts/status.sh' }, mode).problems).toEqual(['scripts/status.sh is not executable.']);
  });

  it.each([
    [{ type: 'command', command: 'ls' }, 'id is missing.'],
    [{ id: 4, type: 'command', command: 'ls' }, 'id is not a string.'],
    [{ id: 'Status', type: 'command', command: 'ls' }, 'id "Status" is not a slug (lowercase letters, digits and hyphens, starting with a letter or digit).'],
    [{ id: '-x', type: 'command', command: 'ls' }, 'id "-x" is not a slug (lowercase letters, digits and hyphens, starting with a letter or digit).'],
    [{ id: 'a b', type: 'command', command: 'ls' }, 'id "a b" is not a slug (lowercase letters, digits and hyphens, starting with a letter or digit).'],
    [{ id: 'a', command: 'ls' }, 'type is missing.'],
    [{ id: 'a', type: 3, command: 'ls' }, 'type is not a string.'],
    [{ id: 'a', type: 'comand', command: 'ls' }, 'type "comand" is not a type this build knows (it knows: command).'],
    [{ id: 'a', type: 'command' }, 'One of command or script is required.'],
    [{ id: 'a', type: 'command', command: 'ls', script: 'x.sh' }, 'command and script are both given; give one.'],
    [{ id: 'a', type: 'command', command: 7 }, 'command is not a string.'],
    [{ id: 'a', type: 'command', command: '  ' }, 'command is empty.'],
    [{ id: 'a', type: 'command', script: '' }, 'script is empty.'],
    [{ id: 'a', type: 'command', command: 'ls', title: 1 }, 'title is not a string.'],
    [{ id: 'a', type: 'command', command: 'ls', hidden: 'yes' }, 'hidden is not true or false.'],
  ])('refuses %j: %s', (raw, problem) => {
    const slot = entry(raw, { 'x.sh': ok });
    expect(slot.problems).toContain(problem);
  });

  it('refuses the second use of an id, and keys the slot by position so state cannot land on the first', () => {
    const seen = new Set<string>();
    const first = validateEntry({ id: 'a', type: 'command', command: 'ls' }, 0, TYPES, report(null), seen);
    const second = validateEntry({ id: 'a', type: 'command', command: 'pwd' }, 1, TYPES, report(null), seen);
    expect(first.problems).toEqual([]);
    expect(second.problems).toEqual(['id "a" is already used by an earlier entry.']);
    expect(second.key).toBe('#1');
  });

  it('collects every problem, not only the first', () => {
    expect(entry({ id: 'A', type: 'nope' }).problems).toEqual([
      'id "A" is not a slug (lowercase letters, digits and hyphens, starting with a letter or digit).',
      'type "nope" is not a type this build knows (it knows: command).',
    ]);
  });

  it('names an entry that is not an object at all', () => {
    expect(entry('git status')).toMatchObject({ key: '#0', type: null, title: 'Entry 1', problems: ['The entry is not an object.'], entry: null });
  });

  it('keeps a degraded entry’s id as its title, so the message says which entry it is about', () => {
    expect(entry({ id: 'status', type: 'command' }).title).toBe('status');
  });

  it('honours hidden, and only true', () => {
    expect(entry({ id: 'a', type: 'command', command: 'ls', hidden: true }).hidden).toBe(true);
    expect(entry({ id: 'a', type: 'command', command: 'ls', hidden: false }).hidden).toBe(false);
  });
});

describe('ID_PATTERN', () => {
  it.each(['a', 'status', 'git-status-2', '0x'])('accepts %s', (id) => expect(ID_PATTERN.test(id)).toBe(true));
  it.each(['', 'A', '-a', 'a_b', 'a.b', 'a b', 'é'])('refuses %j', (id) => expect(ID_PATTERN.test(id)).toBe(false));
});
