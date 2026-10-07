import { describe, it, expect } from 'vitest';
import type { NodeSize } from '../../../../src/renderer/panels/layout';
import { flexFor, snapshot, dragTo, dragTargets, keptSizes, sizesAfterDrag, withOverrides, RAIL, type FlexChild } from '../../../../src/renderer/panels/sizes';

const child = (id: string, size: FlexChild['size'] = null, extra: Partial<FlexChild> = {}): FlexChild => ({ id, size, min: 120, folded: false, ...extra });

/**
 * What a split of `length` px shows for `children`, as CSS flex lays out `flexFor`'s values when there is room: each basis first, then the room left shared by grow weight.
 * Mins are left out: these cases have room for every child.
 */
function layOut(children: FlexChild[], length: number): number[] {
  const values = flexFor(children, undefined).map(({ flex }) => flex.split(' '));
  const basis = values.map(([, , px]) => Number.parseFloat(px));
  const grow = values.map(([weight]) => Number(weight));
  const room = length - basis.reduce((sum, px) => sum + px, 0);
  const total = grow.reduce((sum, weight) => sum + weight, 0);
  return basis.map((px, index) => px + (total === 0 ? 0 : (room * grow[index]) / total));
}

/** The children with the app's overrides in place of their sizes. */
const overridden = (children: FlexChild[], overrides: Record<string, NodeSize>): FlexChild[] => children.map((c) => ({ ...c, size: overrides[c.id] ?? c.size }));

/** Drag the divider between `a` and `b` by `delta` in a split of `length`: what is written, and what the split then shows. */
function drag(children: FlexChild[], length: number, a: number, b: number, delta: number): { written: Record<string, NodeSize>; targets: number[]; after: number[] } {
  const measured = layOut(children, length);
  const targets = dragTargets(children, measured, a, b, delta);
  const written = sizesAfterDrag(children, measured, targets, a, b);
  return { written, targets, after: layOut(overridden(children, written), length) };
}

const within = (actual: number[], expected: number[]): void => actual.forEach((px, index) => expect(Math.abs(px - expected[index])).toBeLessThan(0.5));

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

describe('sizesAfterDrag', () => {
  it('writes the two shares beside the divider, keeping their sum', () => {
    const { written, targets, after } = drag([child('a', { share: 0.5 }), child('b', { share: 0.5 })], 1000, 0, 1, 100);
    expect(written).toEqual({ a: { share: 0.6 }, b: { share: 0.4 } });
    within(after, targets);
  });

  it('gives two children without a size shares of their own, and leaves a third untouched sibling without one', () => {
    const { written, targets, after } = drag([child('a'), child('b'), child('c')], 900, 0, 1, 90);
    expect(Object.keys(written)).toEqual(['a', 'b']);
    within(after, targets);
  });

  it('writes the pair beside a sibling with a share of its own', () => {
    const { written, targets, after } = drag([child('a'), child('b'), child('c', { share: 0.5 })], 1000, 0, 1, -50);
    expect(Object.keys(written)).toEqual(['a', 'b']);
    within(after, targets);
  });

  it('writes a pixel node in pixels, and nothing for the lone flexible child that takes what is left', () => {
    const { written, targets, after } = drag([child('sidebar', { px: 320 }, { min: 220 }), child('claude')], 1300, 0, 1, -40);
    expect(written).toEqual({ sidebar: { px: 280 } });
    within(after, targets);
  });

  it('writes every flexible child when a share for the one beside a pixel node would move its unsized sibling', () => {
    const { written, targets, after } = drag([child('sidebar', { px: 300 }), child('claude'), child('side')], 1300, 0, 1, 100);
    expect(written).toEqual({ sidebar: { px: 400 }, claude: { share: 0.4 }, side: { share: 0.5 } });
    within(after, targets);
  });

  it('writes only pixels between two pixel nodes, leaving the flexible room as it was', () => {
    const { written, targets, after } = drag([child('a', { px: 300 }), child('b', { px: 300 }), child('c')], 1200, 0, 1, 50);
    expect(written).toEqual({ a: { px: 350 }, b: { px: 250 } });
    within(after, targets);
  });

  it('leaves a folded child out, and its own size as it was', () => {
    const children = [child('a', { share: 0.4 }), child('b', { share: 0.3 }), child('c', { share: 0.3 }, { folded: true })];
    const { written, targets, after } = drag(children, 1028, 0, 1, 70);
    expect(Object.keys(written)).toEqual(['a', 'b']);
    within(after, targets);
  });

  it('keeps the proportions the drag left when the window resizes, since shares stay shares', () => {
    const children = [child('a', { share: 0.5 }), child('b', { share: 0.5 })];
    const { written } = drag(children, 1000, 0, 1, 100);
    expect(layOut(overridden(children, written), 2000).map(Math.round)).toEqual([1200, 800]);
  });

  it('reproduces every drag within half a pixel, for every mix of sizes, at every width up to an ultrawide screen', () => {
    const kinds: FlexChild['size'][] = [null, { share: 0.2 }, { share: 0.35 }, { px: 260 }];
    const splits: FlexChild[][] = [];
    for (const x of kinds) for (const y of kinds) for (const z of kinds) splits.push([child('x', x), child('y', y), child('z', z)]);
    let cases = 0;
    for (const children of splits) {
      for (const length of [1280, 1920, 3440]) {
        for (const [a, b] of [
          [0, 1],
          [1, 2],
        ] as const) {
          for (const delta of [-61, -7, 13, 88]) {
            const { targets, after } = drag(children, length, a, b, delta);
            // Only cases with room for every child, which is what `layOut` models.
            if (layOut(children, length).some((px) => px < 0) || targets.some((px) => px < 0)) continue;
            within(after, targets);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
  });

  it('writes shares a person can read, to four places', () => {
    const { written } = drag([child('a'), child('b'), child('c')], 1000, 0, 1, 37);
    // A third of 1000 px each, so 370.33 and 296.33 after the drag.
    expect(written.a).toEqual({ share: 0.3703 });
    expect(written.b).toEqual({ share: 0.2963 });
  });
});

describe('withOverrides', () => {
  const file = [
    { id: 'a', size: null },
    { id: 'b', size: null },
  ];

  it('puts the app’s overrides over the file’s sizes', () => {
    expect(withOverrides(file, { a: { share: 0.6 }, b: { share: 0.4 } })).toEqual({ sizes: [{ share: 0.6 }, { share: 0.4 }], dropped: false });
    expect(withOverrides(file, {})).toEqual({ sizes: [null, null], dropped: false });
  });

  it('keeps them when a sibling added to the file has a size of its own', () => {
    expect(withOverrides([...file, { id: 'c', size: { share: 0.2 } }], { a: { share: 0.6 }, b: { share: 0.4 } }).dropped).toBe(false);
  });

  it('drops them when a sibling added without a size would find no share left, which the file alone does not do', () => {
    expect(withOverrides([...file, { id: 'c', size: null }], { a: { share: 0.6 }, b: { share: 0.4 } })).toEqual({ sizes: [null, null, null], dropped: true });
  });

  it('keeps them where the file’s own shares already leave nothing, since the note is the file’s', () => {
    const exhaustedFile = [
      { id: 'a', size: { share: 0.5 } },
      { id: 'b', size: { share: 0.5 } },
      { id: 'c', size: null },
    ];
    expect(withOverrides(exhaustedFile, { a: { share: 0.6 }, b: { share: 0.4 } }).dropped).toBe(false);
  });

  it('judges pixels apart from the shares', () => {
    expect(withOverrides([{ id: 's', size: { px: 320 } }, ...file], { s: { px: 280 } })).toEqual({ sizes: [{ px: 280 }, null, null], dropped: false });
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
