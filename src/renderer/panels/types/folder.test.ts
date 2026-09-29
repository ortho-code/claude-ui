import { describe, it, expect } from 'vitest';
import type { TypeReport } from '../../../shared/panels';
import { commandType } from './command';
import { checkManifest, escapes, folderTypes } from './folder';

const report = (json: unknown, over: Partial<TypeReport> = {}): TypeReport => ({
  name: 'reviews',
  dir: '/cfg/types/reviews',
  status: 'read',
  error: null,
  json,
  ...over,
});

const SOUND = { version: 1, kind: 'list', title: 'Reviews', icon: 'check', run: 'queue', interval: '5m', options: [{ name: 'for', kind: 'text' }] };
const AT = 'types/reviews/panel.json: ';

describe('checkManifest', () => {
  it('reads a sound manifest, saying nothing about it', () => {
    expect(checkManifest(report(SOUND))).toEqual({
      name: 'reviews',
      dir: '/cfg/types/reviews',
      manifest: { kind: 'list', title: 'Reviews', icon: 'check', run: 'queue', interval: '5m', options: [{ name: 'for', kind: 'text' }] },
      problems: [],
      notes: [],
    });
  });

  it('needs only a version, a kind and a script', () => {
    expect(checkManifest(report({ version: 1, kind: 'list', run: 'bin/list.sh' })).manifest).toEqual({
      kind: 'list',
      title: null,
      icon: null,
      run: 'bin/list.sh',
      interval: null,
      options: [],
    });
  });

  it('says a folder has no manifest, or one that does not parse, or one that is not an object', () => {
    expect(checkManifest(report(null, { status: 'missing' })).problems).toEqual(['types/reviews has no panel.json.']);
    expect(checkManifest(report(null, { status: 'unparsable', error: 'Unexpected end of JSON input' })).problems).toEqual([
      'types/reviews/panel.json does not parse: Unexpected end of JSON input.',
    ]);
    expect(checkManifest(report([1])).problems).toEqual(['types/reviews/panel.json is not a JSON object.']);
  });

  it.each([
    [{ version: undefined }, 'version is missing (this build reads 1).'],
    [{ version: 2 }, 'version 2 is not one this build reads (it reads 1).'],
    [{ kind: undefined }, 'kind is missing (this build has: list).'],
    [{ kind: 'html' }, 'kind "html" is not a kind this build has (it has: list).'],
    [{ title: 3 }, 'title is not a string.'],
    [{ title: ' ' }, 'title is empty.'],
    [{ run: undefined }, 'run is missing: the script this type runs, relative to its folder.'],
    [{ run: 7 }, 'run is not a string.'],
    [{ run: '' }, 'run is empty.'],
    [{ run: '/usr/bin/queue' }, 'run /usr/bin/queue is not inside the type’s folder; give a path relative to it.'],
    [{ run: '~/bin/queue' }, 'run ~/bin/queue is not inside the type’s folder; give a path relative to it.'],
    [{ run: 'bin/../../other/queue' }, 'run bin/../../other/queue is not inside the type’s folder; give a path relative to it.'],
    [{ interval: 'often' }, 'interval "often" is not a duration like 30s, 5m or 1h.'],
    [{ interval: '1s' }, 'interval 1s is shorter than the 10s it can be at the least.'],
    [{ options: {} }, 'options is not an array.'],
    [{ options: ['for'] }, 'options[0] is not an object.'],
    [{ options: [{ kind: 'text' }] }, 'options[0] has no name.'],
    [{ options: [{ name: 'For', kind: 'text' }] }, 'option "For" is not lowercase letters, digits and underscores, starting with a letter.'],
    [{ options: [{ name: 'cwd', kind: 'text' }] }, 'option cwd is the list kind’s own; call it something else.'],
    [{ options: [{ name: 'interval', kind: 'text' }] }, 'option interval is the list kind’s own; call it something else.'],
    [{ options: [{ name: 'for', kind: 'text' }, { name: 'for', kind: 'text' }] }, 'option for is declared twice.'],
    [{ options: [{ name: 'for' }] }, 'option for has no kind (it can be: text).'],
    [{ options: [{ name: 'repo', kind: 'path' }] }, 'option repo: kind "path" is not one a manifest can declare in this build (it can: text).'],
  ])('refuses %j: %s', (over, problem) => {
    const checked = checkManifest(report({ ...SOUND, ...over }));
    expect(checked.problems).toEqual([AT + problem]);
    expect(checked.manifest).toBeNull();
  });

  it('collects every problem, not only the first', () => {
    expect(checkManifest(report({ kind: 'html', run: '/x' })).problems).toEqual([
      `${AT}version is missing (this build reads 1).`,
      `${AT}kind "html" is not a kind this build has (it has: list).`,
      `${AT}run /x is not inside the type’s folder; give a path relative to it.`,
    ]);
  });

  it('notes what it does not stop on: an icon it does not have, and fields it does not read', () => {
    const checked = checkManifest(report({ ...SOUND, icon: 'rocket', colour: 'red', options: [{ name: 'for', kind: 'text', default: 'me' }] }));
    expect(checked.problems).toEqual([]);
    expect(checked.manifest?.icon).toBeNull();
    expect(checked.notes).toEqual([
      expect.stringMatching(/^types\/reviews\/panel\.json: icon "rocket" is not an icon this build has \(it has: .+\); the list icon is used\.$/),
      `${AT}option for: default is not a field this build reads; it is ignored.`,
      `${AT}colour is not a field this build reads; it is ignored.`,
    ]);
  });
});

describe('escapes', () => {
  it.each(['queue', 'bin/queue', './queue', 'a/../queue', 'a//b'])('keeps %s inside', (value) => expect(escapes(value)).toBe(false));
  it.each(['../queue', 'a/../../queue', '..'])('takes %s outside', (value) => expect(escapes(value)).toBe(true));
});

describe('folderTypes', () => {
  const builtins = { command: commandType };

  it('adds a type per folder beside the built-ins, named after the folder', () => {
    const { types, notes } = folderTypes([report(SOUND)], builtins);
    expect(Object.keys(types)).toEqual(['command', 'reviews']);
    expect(notes).toEqual([]);
    const reviews = types.reviews;
    expect(reviews).toMatchObject({ name: 'reviews', icon: 'check', exactlyOne: [] });
    expect(reviews.defaultTitle({})).toBe('Reviews');
    // The list kind's own options first, then the manifest's.
    expect(reviews.options.map((option) => option.name)).toEqual(['cwd', 'interval', 'for']);
  });

  it('keeps a type whose manifest is wrong, so its entries say why where they stand', () => {
    const { types } = folderTypes([report({ version: 1, kind: 'list' })], builtins);
    expect(types.reviews).toMatchObject({ name: 'reviews', icon: 'list', options: [] });
    expect(types.reviews.defaultTitle({})).toBeNull();
  });

  it('does not read a folder named like a built-in, or one whose name cannot be a type’s, and says so', () => {
    const { types, notes } = folderTypes([report(SOUND, { name: 'command' }), report(SOUND, { name: 'My Reviews' })], builtins);
    expect(types.command).toBe(commandType);
    expect(Object.keys(types)).toEqual(['command']);
    expect(notes).toEqual([
      'types/command is not read: command is a type the app has built in.',
      'types/My Reviews is not read: a type is named after its folder, and the name has to be lowercase letters, digits, hyphens and underscores, starting with a letter or digit.',
    ]);
  });

  it('gives a type a revision that follows its manifest, so an edit mounts its panels afresh', () => {
    const before = folderTypes([report(SOUND)], builtins).types.reviews.revision;
    expect(folderTypes([report(SOUND)], builtins).types.reviews.revision).toBe(before);
    expect(folderTypes([report({ ...SOUND, interval: '10m' })], builtins).types.reviews.revision).not.toBe(before);
    expect(commandType.revision).toBeUndefined();
  });
});
