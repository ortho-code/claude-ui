import { describe, it, expect } from 'vitest';
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
        sections: [
          {
            empty: 'Nothing waiting on you.',
            items: [
              {
                key: 'org/repo#1',
                text: 'Fix the login redirect',
                detail: '#1 · 31h · someone',
                href: 'https://github.com/org/repo/pull/1',
                tone: 'attention',
                actions: [{ label: 'Review', session: { prompt: '/review 1', name: 'Review #1' } }],
              },
            ],
          },
          { title: 'Blocked', shut: true, items: [] },
        ],
        notes: ['Could not read team membership.'],
      }),
    );
    expect(read).toEqual({
      doc: {
        badge: 3,
        sections: [
          {
            title: null,
            shut: false,
            empty: 'Nothing waiting on you.',
            items: [
              {
                key: 'org/repo#1',
                text: 'Fix the login redirect',
                detail: '#1 · 31h · someone',
                href: 'https://github.com/org/repo/pull/1',
                tone: 'attention',
                actions: [{ label: 'Review', prompt: '/review 1', name: 'Review #1' }],
              },
            ],
          },
          { title: 'Blocked', shut: true, empty: null, items: [] },
        ],
        notes: ['Could not read team membership.'],
      },
      problems: [],
    });
  });

  it('needs only a version, sections, and a key and text per item', () => {
    expect(readListDocument(doc()).doc).toEqual({
      badge: null,
      sections: [{ title: null, shut: false, empty: null, items: [{ ...item, detail: null, href: null, tone: 'normal', actions: [] }] }],
      notes: [],
    });
  });

  it('ignores what this build does not know: fields, and an action of a kind it does not have', () => {
    const read = readListDocument(doc({ generatedAt: 'now', sections: [{ colour: 'red', items: [{ ...item, weight: 3, actions: [{ label: 'Merge', merge: {} }] }] }] }));
    expect(read.problems).toEqual([]);
    expect(read.doc?.sections[0]?.items[0]?.actions).toEqual([]);
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
    [{ notes: [3] }, 'notes[0] is not a string.'],
    [{ sections: [3] }, 'sections[0] is not an object.'],
    [{ sections: [{}] }, 'sections[0].items is missing.'],
    [{ sections: [{ shut: true, items: [] }] }, 'sections[0].shut needs a title, which is what stays when it folds.'],
    [{ sections: [{ title: 'x', shut: 'yes', items: [] }] }, 'sections[0].shut is not true or false.'],
    [{ sections: [{ items: [{ text: 'x' }] }] }, 'sections[0].items[0].key is missing.'],
    [{ sections: [{ items: [{ key: 'a' }] }] }, 'sections[0].items[0].text is missing.'],
    [{ sections: [{ items: [{ key: ' ', text: 'x' }] }] }, 'sections[0].items[0].key is empty.'],
    [{ sections: [{ items: [item] }, { items: [item] }] }, 'sections[1].items[0].key "org/repo#1" is already used by another item.'],
    [{ sections: [{ items: [{ ...item, href: 'file:///etc/passwd' }] }] }, 'sections[0].items[0].href "file:///etc/passwd" is not an http or https link.'],
    [{ sections: [{ items: [{ ...item, tone: 'loud' }] }] }, 'sections[0].items[0].tone "loud" is not one of normal, attention, muted, danger.'],
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
