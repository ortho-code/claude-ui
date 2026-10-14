import { describe, it, expect } from 'vitest';
import { ICON_NAMES } from '../../../../../src/renderer/panels/icons';
import { readListDocument } from '../../../../../src/renderer/panels/types/listdoc';

const item = { key: 'org/repo#1', text: 'Fix the login redirect' };
const doc = (over: Record<string, unknown> = {}): string => JSON.stringify({ version: 1, sections: [{ items: [item] }], ...over });
const problems = (text: string): string[] => readListDocument(text).problems;

describe('readListDocument', () => {
  it('reads a full document', () => {
    const read = readListDocument(
      JSON.stringify({
        version: 1,
        badge: 3,
        views: [
          { id: 'flat', label: 'Flat', icon: 'list' },
          { id: 'tree', label: 'Tree', icon: 'tree' },
        ],
        compact: true,
        separator: ' / ',
        sections: [
          {
            empty: 'Nothing waiting on you.',
            items: [
              {
                key: 'org/repo#1',
                lead: 'PR',
                leadTone: 'positive',
                text: 'Fix the login redirect',
                cut: 'start',
                trail: '+12 −3',
                tooltip: 'Fix the login redirect after a session times out',
                detail: [['#1', '31h', 'someone'], [{ text: 'Waiting on you' }]],
                separator: ' | ',
                href: 'https://github.com/org/repo/pull/1',
                tone: 'attention',
                actions: [{ label: 'Review', session: { prompt: '/review 1', name: 'Review #1' } }],
              },
            ],
          },
          { title: 'Blocked', shut: true, tooltip: 'PRs waiting on someone else first', items: [] },
        ],
        notes: ['Could not read team membership.'],
      }),
    );
    expect(read).toEqual({
      doc: {
        badge: 3,
        views: [
          { id: 'flat', label: 'Flat', icon: 'list' },
          { id: 'tree', label: 'Tree', icon: 'tree' },
        ],
        compact: true,
        sections: [
          {
            title: null,
            shut: false,
            tooltip: null,
            empty: 'Nothing waiting on you.',
            items: [
              {
                key: 'org/repo#1',
                lead: 'PR',
                leadTone: 'positive',
                text: 'Fix the login redirect',
                cut: 'start',
                trail: '+12 −3',
                tooltip: 'Fix the login redirect after a session times out',
                detail: [[{ text: '#1' }, { text: '31h' }, { text: 'someone' }], [{ text: 'Waiting on you' }]],
                separator: ' | ',
                href: 'https://github.com/org/repo/pull/1',
                tone: 'attention',
                actions: [{ label: 'Review', prompt: '/review 1', name: 'Review #1' }],
                children: [],
                shut: false,
              },
            ],
          },
          { title: 'Blocked', shut: true, tooltip: 'PRs waiting on someone else first', empty: null, items: [] },
        ],
        notes: ['Could not read team membership.'],
      },
      problems: [],
    });
  });

  it('needs only a version, sections, and a key and text per item', () => {
    expect(readListDocument(doc()).doc).toEqual({
      badge: null,
      views: [],
      compact: false,
      sections: [{ title: null, shut: false, tooltip: null, empty: null, items: [{ ...item, lead: null, leadTone: 'normal', cut: 'end', trail: null, tooltip: null, detail: [], separator: ' · ', href: null, tone: 'normal', actions: [], children: [], shut: false }] }],
      notes: [],
    });
  });

  it("puts a row's own separator between the parts of its lines, else the list's, else ' · ', an empty one included", () => {
    const separators = (list: Record<string, unknown>, items: Record<string, unknown>[]): string[] =>
      readListDocument(doc({ ...list, sections: [{ items: items.map((over, at) => ({ key: `k${at}`, text: 't', detail: [['a', 'b']], ...over })) }] })).doc!.sections[0].items.map(({ separator }) => separator);
    expect(separators({}, [{}, { separator: ' / ' }])).toEqual([' · ', ' / ']);
    expect(separators({ separator: ' | ' }, [{}, { separator: '' }])).toEqual([' | ', '']);
  });

  it("reads a child's lines and separator as a row's: its own separator, else the list's rather than its parent's", () => {
    const parent = { key: 'p', text: 'p', separator: ' / ', children: [{ key: 'c', text: 'c', detail: [['a', { text: 'b' }]] }] };
    const [child] = readListDocument(doc({ separator: ' | ', sections: [{ items: [parent] }] })).doc!.sections[0].items[0].children;
    expect(child.detail).toEqual([[{ text: 'a' }, { text: 'b' }]]);
    expect(child.separator).toBe(' | ');
  });

  it('reads the rows a row holds, at any depth, with its keys unique across every level', () => {
    const folder = { key: 'src', text: 'src', shut: true, children: [{ key: 'src/a', text: 'a' }, { key: 'src/lib', text: 'lib', children: [{ key: 'src/lib/b', text: 'b' }] }] };
    const [read] = readListDocument(doc({ sections: [{ items: [folder] }] })).doc!.sections[0].items;
    expect(read.shut).toBe(true);
    expect(read.children.map(({ key }) => key)).toEqual(['src/a', 'src/lib']);
    expect(read.children[1].children.map(({ key, children }) => [key, children])).toEqual([['src/lib/b', []]]);
    expect(problems(doc({ sections: [{ items: [{ ...item, children: [item] }] }] }))).toEqual(['sections[0].items[0].children[0].key "org/repo#1" is already used by another item.']);
  });

  it('ignores what this build does not know: fields, and an action of a kind it does not have', () => {
    const read = readListDocument(doc({ generatedAt: 'now', sections: [{ colour: 'red', items: [{ ...item, weight: 3, detail: [[{ text: 'a', weight: 3 }]], actions: [{ label: 'Merge', merge: {} }] }] }] }));
    expect(read.problems).toEqual([]);
    expect(read.doc?.sections[0]?.items[0]?.actions).toEqual([]);
    expect(read.doc?.sections[0]?.items[0]?.detail).toEqual([[{ text: 'a' }]]);
  });

  it('says what is wrong with the whole of what was printed', () => {
    expect(problems('')).toEqual(['It printed nothing.']);
    expect(problems('[review:queue] $ queue\n{}')[0]).toMatch(/^What it printed is not JSON: /);
    expect(problems('[1]')).toEqual(['What it printed is not a JSON object.']);
    expect(problems('{"sections": []}')).toEqual(['version is missing (this build reads 1).']);
    expect(problems('{"version": 2, "sections": []}')).toEqual(['version 2 is not one this build reads (it reads 1).']);
  });

  it.each([
    [{ sections: undefined }, 'sections is missing.'],
    [{ sections: {} }, 'sections is not an array.'],
    [{ badge: -1 }, 'badge is not a whole number, 0 or more.'],
    [{ badge: 1.5 }, 'badge is not a whole number, 0 or more.'],
    [{ compact: 'yes' }, 'compact is not true or false.'],
    [{ views: {} }, 'views is not an array.'],
    [{ views: [{ label: 'Flat', icon: 'list' }] }, 'views[0].id is missing.'],
    [{ views: [{ id: 'Flat', label: 'Flat', icon: 'list' }] }, 'views[0].id "Flat" is not a slug (lowercase letters, digits, hyphens and underscores, starting with a letter or digit).'],
    [{ views: [{ id: 'flat', icon: 'list' }] }, 'views[0].label is missing.'],
    [{ views: [{ id: 'flat', label: 'Flat' }] }, 'views[0].icon is missing.'],
    [{ views: [{ id: 'flat', label: 'Flat', icon: 'rocket' }] }, `views[0].icon "rocket" is not an icon this build has (it has: ${ICON_NAMES.join(', ')}).`],
    [
      {
        views: [
          { id: 'flat', label: 'Flat', icon: 'list' },
          { id: 'flat', label: 'Also flat', icon: 'list' },
        ],
      },
      'views[1].id "flat" is already used by another view.',
    ],
    [{ notes: [3] }, 'notes[0] is not a string.'],
    [{ sections: [3] }, 'sections[0] is not an object.'],
    [{ sections: [{}] }, 'sections[0].items is missing.'],
    [{ sections: [{ shut: true, items: [] }] }, 'sections[0].shut needs a title, which is what stays when it folds.'],
    [{ sections: [{ title: 'x', shut: 'yes', items: [] }] }, 'sections[0].shut is not true or false.'],
    [{ sections: [{ title: 'x', tooltip: 3, items: [] }] }, 'sections[0].tooltip is not a string.'],
    [{ sections: [{ tooltip: 'x', items: [] }] }, 'sections[0].tooltip needs a title, which is what it shows over.'],
    [{ sections: [{ items: [{ text: 'x' }] }] }, 'sections[0].items[0].key is missing.'],
    [{ sections: [{ items: [{ key: 'a' }] }] }, 'sections[0].items[0].text is missing.'],
    [{ sections: [{ items: [{ key: ' ', text: 'x' }] }] }, 'sections[0].items[0].key is empty.'],
    [{ sections: [{ items: [item] }, { items: [item] }] }, 'sections[1].items[0].key "org/repo#1" is already used by another item.'],
    [{ sections: [{ items: [{ ...item, tooltip: 3 }] }] }, 'sections[0].items[0].tooltip is not a string.'],
    [{ sections: [{ items: [{ ...item, lead: 3 }] }] }, 'sections[0].items[0].lead is not a string.'],
    [{ sections: [{ items: [{ ...item, trail: 3 }] }] }, 'sections[0].items[0].trail is not a string.'],
    [{ separator: 3 }, 'separator is not a string.'],
    [{ sections: [{ items: [{ ...item, separator: 3 }] }] }, 'sections[0].items[0].separator is not a string.'],
    [{ sections: [{ items: [{ ...item, detail: '#1 · 3d' }] }] }, 'sections[0].items[0].detail is not an array.'],
    [{ sections: [{ items: [{ ...item, detail: ['#1', '3d'] }] }] }, 'sections[0].items[0].detail[0] is not a line, which is an array of parts.'],
    [{ sections: [{ items: [{ ...item, detail: [['#1'], []] }] }] }, 'sections[0].items[0].detail[1] is empty.'],
    [{ sections: [{ items: [{ ...item, detail: [['#1', 3]] }] }] }, 'sections[0].items[0].detail[0][1] is not a string or an object.'],
    [{ sections: [{ items: [{ ...item, detail: [['#1', ' ']] }] }] }, 'sections[0].items[0].detail[0][1] is empty.'],
    [{ sections: [{ items: [{ ...item, detail: [[{}]] }] }] }, 'sections[0].items[0].detail[0][0].text is missing.'],
    [{ sections: [{ items: [{ ...item, detail: [[{ text: '' }]] }] }] }, 'sections[0].items[0].detail[0][0].text is empty.'],
    [{ sections: [{ items: [{ ...item, children: [{ key: 'c', text: 'c', detail: [[3]] }] }] }] }, 'sections[0].items[0].children[0].detail[0][0] is not a string or an object.'],
    [{ sections: [{ items: [{ ...item, leadTone: 'loud' }] }] }, 'sections[0].items[0].leadTone "loud" is not one of normal, attention, positive, muted, danger.'],
    [{ sections: [{ items: [{ ...item, cut: 'middle' }] }] }, 'sections[0].items[0].cut "middle" is not one of end, start.'],
    [{ sections: [{ items: [{ ...item, children: {} }] }] }, 'sections[0].items[0].children is not an array.'],
    [{ sections: [{ items: [{ ...item, children: [{ key: 'child' }] }] }] }, 'sections[0].items[0].children[0].text is missing.'],
    [{ sections: [{ items: [{ ...item, shut: true }] }] }, 'sections[0].items[0].shut needs children, which are what it folds.'],
    [{ sections: [{ items: [{ ...item, shut: true, children: [] }] }] }, 'sections[0].items[0].shut needs children, which are what it folds.'],
    [{ sections: [{ items: [{ ...item, href: 'file:///etc/passwd' }] }] }, 'sections[0].items[0].href "file:///etc/passwd" is not an http or https link.'],
    [{ sections: [{ items: [{ ...item, tone: 'loud' }] }] }, 'sections[0].items[0].tone "loud" is not one of normal, attention, positive, muted, danger.'],
    [{ sections: [{ items: [{ ...item, actions: [{ session: { prompt: 'x' } }] }] }] }, 'sections[0].items[0].actions[0].label is missing.'],
    [{ sections: [{ items: [{ ...item, actions: [{ label: 'Review', session: {} }] }] }] }, 'sections[0].items[0].actions[0].session.prompt is missing.'],
    [{ sections: [{ items: [{ ...item, actions: [{ label: 'Review', session: 'x' }] }] }] }, 'sections[0].items[0].actions[0].session is not an object.'],
  ])('refuses %j: %s', (over, problem) => {
    const read = readListDocument(doc(over));
    expect(read.problems).toContain(problem);
    expect(read.doc).toBeNull();
  });

  it('collects every problem, not only the first', () => {
    expect(problems(doc({ badge: 'x', sections: [{ items: [{ key: 'a' }, { text: 'b' }] }] }))).toEqual([
      'badge is not a whole number, 0 or more.',
      'sections[0].items[0].text is missing.',
      'sections[0].items[1].key is missing.',
    ]);
  });
});
