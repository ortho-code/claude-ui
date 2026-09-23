import { describe, it, expect } from 'vitest';
import { flexFor, snapshot, dragTo, keptSizes, RAIL, type FlexChild } from './sizes';

const child = (id: string, size: FlexChild['size'] = null, extra: Partial<FlexChild> = {}): FlexChild => ({ id, size, min: 120, folded: false, ...extra });

describe('flexFor', () => {
  it('grows the flexible children by the file’s shares, the unsized sharing what is left', () => {
    expect(flexFor([child('a', { share: 0.25 }), child('b')], undefined)).toEqual([
      { flex: '0.25 1 0px', min: 120 },
      { flex: '0.75 1 0px', min: 120 },
    ]);
    expect(flexFor([child('a', { share: 2 }), child('b', { share: 1 })], undefined).map((v) => v.flex)).toEqual(['2 1 0px', '1 1 0px']);
  });

  it('gives a pixel child its px as a basis it never grows from, and lets it give way down to its min', () => {
    const values = flexFor([child('sidebar', { px: 320 }, { min: 220 }), child('claude')], undefined);
    expect(values).toEqual([
      { flex: '0 1 320px', min: 220 },
      { flex: '1 1 0px', min: 120 },
    ]);
  });

  it('keeps pixel children out of the shares', () => {
    const values = flexFor([child('sidebar', { px: 320 }), child('claude'), child('side', { share: 0.3 })], undefined);
    expect(values[1].flex).toBe('0.7 1 0px');
    expect(values[2].flex).toBe('0.3 1 0px');
  });

  it('makes a folded group its rail, with no min, and leaves it out of the shares', () => {
    const values = flexFor([child('claude'), child('drawer', { share: 0.3 }, { folded: true })], undefined);
    expect(values).toEqual([
      { flex: '1 1 0px', min: 120 },
      { flex: `0 0 ${RAIL}px`, min: null },
    ]);
  });

  it('weights the flexible children by their dragged px once every one of them has some, and gives a pixel child its dragged px', () => {
    const values = flexFor([child('sidebar', { px: 320 }), child('claude'), child('side', { share: 0.3 })], { sidebar: 280, claude: 700, side: 300 });
    expect(values.map((v) => v.flex)).toEqual(['0 1 280px', '700 1 0px', '300 1 0px']);
  });

  it('falls back to the file’s shares while one flexible child has no dragged px', () => {
    const values = flexFor([child('claude'), child('side', { share: 0.3 })], { claude: 700 });
    expect(values.map((v) => v.flex)).toEqual(['0.7 1 0px', '0.3 1 0px']);
  });

  it('does not ask a folded child for dragged px before honouring the rest', () => {
    const values = flexFor([child('claude'), child('side'), child('drawer', null, { folded: true })], { claude: 600, side: 300 });
    expect(values.map((v) => v.flex)).toEqual(['600 1 0px', '300 1 0px', `0 0 ${RAIL}px`]);
  });
});

describe('snapshot', () => {
  it('stores what each child on show measures, and keeps a folded child’s size from before it folded', () => {
    const children = [child('a'), child('b', null, { folded: true }), child('c')];
    expect(snapshot(children, [300, RAIL, 500], { b: 250, gone: 9 })).toEqual({ a: 300, b: 250, c: 500 });
  });

  it('stores nothing for a folded child that never had a size', () => {
    expect(snapshot([child('a'), child('b', null, { folded: true })], [300, RAIL])).toEqual({ a: 300 });
  });
});

describe('dragTo', () => {
  const three = [child('a'), child('b'), child('c')];

  it('moves the two children beside the divider against each other, and stores every other at what it measures', () => {
    expect(dragTo(three, [300, 500, 200], 0, 1, 50)).toEqual({ a: 350, b: 450, c: 200 });
    expect(dragTo(three, [300, 500, 200], 1, 2, -80)).toEqual({ a: 300, b: 420, c: 280 });
  });

  it('stops each at its min', () => {
    expect(dragTo(three, [300, 500, 200], 0, 1, -400)).toEqual({ a: 120, b: 680, c: 200 });
    expect(dragTo(three, [300, 500, 200], 0, 1, 900)).toEqual({ a: 680, b: 120, c: 200 });
  });

  it('lets a child squeezed below its min grow, and neither shrinks it further nor makes it jump', () => {
    expect(dragTo(three, [100, 500, 200], 0, 1, -30)).toEqual({ a: 100, b: 500, c: 200 });
    expect(dragTo(three, [100, 500, 200], 0, 1, 40)).toEqual({ a: 140, b: 460, c: 200 });
  });

  it('keeps a folded child’s earlier size, so it unfolds to it', () => {
    const children = [child('a'), child('b'), child('c', null, { folded: true })];
    expect(dragTo(children, [300, 500, RAIL], 0, 1, 20, { c: 260 })).toEqual({ a: 320, b: 480, c: 260 });
  });
});

describe('keptSizes', () => {
  it('keeps stored sizes that name exactly the split’s children', () => {
    const stored = { a: 1, b: 2 };
    expect(keptSizes(stored, ['b', 'a'])).toBe(stored);
  });

  it('drops them whole when a child was added or removed', () => {
    expect(keptSizes({ a: 1, b: 2 }, ['a', 'b', 'c'])).toBeUndefined();
    expect(keptSizes({ a: 1, b: 2, c: 3 }, ['a', 'b'])).toBeUndefined();
    expect(keptSizes({ a: 1, c: 3 }, ['a', 'b'])).toBeUndefined();
  });

  it('has nothing to keep without stored sizes', () => {
    expect(keptSizes(undefined, ['a'])).toBeUndefined();
  });
});
