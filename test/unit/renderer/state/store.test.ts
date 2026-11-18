import { afterEach, describe, it, expect, vi } from 'vitest';

import { createStore } from '../../../../src/renderer/state/store';

interface Shape {
  count: number;
  name: string;
  items: string[];
}

const fresh = (): ReturnType<typeof createStore<Shape>> => createStore<Shape>({ count: 0, name: 'a', items: [] });

/** What the store reports from now on: the microtasks it queues, held here rather than run, where each would be an uncaught error that fails the run. */
function reports(): (() => void)[] {
  const queued: (() => void)[] = [];
  vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
    queued.push(task);
  });
  return queued;
}

/** The message a reported task throws when it runs. */
function thrown(task: () => void): string {
  try {
    task();
  } catch (error) {
    return (error as Error).message;
  }
  return 'nothing thrown';
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The frames asked for from now on, held here, run by `frame()` one at a time. */
function frames(): { frame: () => void; asked: () => number } {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => queue.push(callback));
  return { frame: () => queue.splice(0).forEach((callback) => callback(0)), asked: () => queue.length };
}

describe('a watcher told once a frame', () => {
  it('is told at the next frame, once, with what moved since its last call, while a plain watcher is told at once', () => {
    const { frame, asked } = frames();
    const store = fresh();
    const told: string[] = [];
    store.watch(['count'], (view, before) => told.push(`frame ${before.count}->${view.count}`), { frame: true });
    store.watch(['count'], (view) => told.push(`now ${view.count}`));
    store.set({ count: 1 });
    store.set({ count: 2 });
    expect(told).toEqual(['now 1', 'now 2']);
    expect(asked()).toBe(1);
    frame();
    expect(told).toEqual(['now 1', 'now 2', 'frame 0->2']);
    frame();
    expect(told).toHaveLength(3);
  });

  it('is not told once it unsubscribed, even of a change before that', () => {
    const { frame } = frames();
    const store = fresh();
    let told = 0;
    const unsubscribe = store.watch(['count'], () => told++, { frame: true });
    store.set({ count: 1 });
    unsubscribe();
    frame();
    expect(told).toBe(0);
  });

  it('is not told of a change undone before the frame', () => {
    const { frame } = frames();
    const store = fresh();
    let told = 0;
    store.watch(['count'], () => told++, { frame: true });
    store.set({ count: 1 });
    store.set({ count: 0 });
    frame();
    expect(told).toBe(0);
  });

  it('does not keep the others from being told when it throws, and the throw is reported', () => {
    const { frame } = frames();
    const queued = reports();
    const store = fresh();
    let told = 0;
    store.watch(
      ['count'],
      () => {
        throw new Error('broken repaint');
      },
      { frame: true },
    );
    store.watch(['count'], () => told++, { frame: true });
    store.set({ count: 1 });
    frame();
    expect(told).toBe(1);
    expect(queued.map(thrown)).toEqual(['broken repaint']);
  });
});

describe('createStore', () => {
  it('tells the watchers of a slice that changed, and only those, before set returns', () => {
    const store = fresh();
    const told: string[] = [];
    store.watch(['count'], (view) => told.push(`count ${view.count}`));
    store.watch(['name'], (view) => told.push(`name ${view.name}`));
    store.set({ count: 1 });
    expect(told).toEqual(['count 1']);
  });

  it('does not tell for a value equal to the last, and a slice’s own equality decides that, while the value is stored all the same', () => {
    const store = createStore<Shape>({ count: 0, name: 'a', items: ['x'] }, { items: (a, b) => a.join() === b.join() });
    let told = 0;
    store.watch(['count', 'items'], () => told++);
    store.set({ count: 0 });
    const same = ['x'];
    store.set({ items: same });
    expect(told).toBe(0);
    // Equal, so nobody is told; stored, so a handler reads the newest.
    expect(store.get().items).toBe(same);
    store.set({ items: ['y'] });
    expect(told).toBe(1);
  });

  it('answers whether two values of a slice are the same by that slice’s own equality, and by identity where it has none', () => {
    const store = createStore<Shape>({ count: 0, name: 'a', items: ['x'] }, { items: (a, b) => a.join() === b.join() });
    expect(store.same('items', ['x', 'y'], ['x', 'y'])).toBe(true);
    expect(store.same('items', ['x'], ['y'])).toBe(false);
    expect(store.same('count', 1, 1)).toBe(true);
    expect(store.same('name', 'a', 'b')).toBe(false);
  });

  it('tells once at the end of a batch, with everything it changed, and only at the outermost of nested ones', () => {
    const store = fresh();
    const views: string[] = [];
    store.watch(['count', 'name'], (view) => views.push(`${view.count} ${view.name}`));
    store.batch(() => {
      store.set({ count: 1 });
      store.batch(() => store.set({ name: 'b' }));
      expect(views).toEqual([]);
      store.set({ count: 2 });
    });
    expect(views).toEqual(['2 b']);
  });

  it('tells a watcher once per round however many of its slices changed', () => {
    const store = fresh();
    let told = 0;
    store.watch(['count', 'name'], () => told++);
    store.set({ count: 1, name: 'b' });
    expect(told).toBe(1);
  });

  it('does not re-enter a watcher that sets state: what it set is told after the round, in subscription order', () => {
    const store = fresh();
    const order: string[] = [];
    store.watch(['count'], (view) => {
      order.push(`first sees ${view.count}`);
      if (view.count === 1) store.set({ name: 'from first' });
    });
    store.watch(['count', 'name'], (view) => order.push(`second sees ${view.count} ${view.name}`));
    store.set({ count: 1 });
    expect(order).toEqual(['first sees 1', 'second sees 1 from first', 'second sees 1 from first']);
  });

  it('stops telling after unsubscribe, including one made in the middle of a round', () => {
    const store = fresh();
    const told: string[] = [];
    let offSecond = (): void => {};
    const offFirst = store.watch(['count'], () => {
      told.push('first');
      offSecond();
    });
    offSecond = store.watch(['count'], () => told.push('second'));
    store.set({ count: 1 });
    offFirst();
    store.set({ count: 2 });
    expect(told).toEqual(['first']);
  });

  it('tells every watcher even when one throws, and reports each failure on its own rather than throwing it into the writer', () => {
    const store = fresh();
    const reported = reports();
    const told: string[] = [];
    store.watch(['count'], () => {
      throw new Error('first failed');
    });
    store.watch(['count'], () => told.push('second'));
    store.watch(['count'], () => {
      throw new Error('third failed');
    });
    expect(() => store.set({ count: 1 })).not.toThrow();
    expect(told).toEqual(['second']);
    expect(reported.map(thrown)).toEqual(['first failed', 'third failed']);
  });

  it('stops two watchers that keep changing each other, and reports it rather than looping', () => {
    const store = fresh();
    const reported = reports();
    store.watch(['count'], (view) => store.set({ name: String(view.count) }));
    store.watch(['name'], (view) => store.set({ count: Number(view.name) + 1 }));
    expect(() => store.set({ count: 1 })).not.toThrow();
    expect(reported.map(thrown)).toEqual([expect.stringMatching(/kept changing/)]);
  });

  it('does not call a watcher when it subscribes', () => {
    const store = fresh();
    let told = 0;
    store.watch(['count'], () => told++);
    expect(told).toBe(0);
  });

  it('hands a watcher a view of only the slices it named, which the compiler holds it to', () => {
    const store = fresh();
    store.watch(['count'], (view) => {
      expect(view.count).toBe(1);
      // @ts-expect-error — `name` was not subscribed to, so a repaint reading it would never be told when it changes.
      expect(view.name).toBe('a');
    });
    store.set({ count: 1 });
  });

  it('hands a watcher the slices it reads without being told about them, and does not tell it when those change', () => {
    const store = fresh();
    const seen: string[] = [];
    store.watch(['count'], (view) => seen.push(`${view.count} ${view.name}`), { reads: ['name'] });
    store.set({ name: 'b' });
    expect(seen).toEqual([]);
    store.set({ count: 1 });
    expect(seen).toEqual(['1 b']);
    store.watch(
      ['count'],
      (view) => {
        // @ts-expect-error — `items` was neither told nor read, so the compiler still refuses it.
        expect(view.items).toEqual([]);
      },
      { reads: ['name'] },
    );
    store.set({ count: 2 });
  });

  it('hands a watcher its slices as it last handed them, and the same value where one has not changed by its equality', () => {
    const store = createStore<Shape>({ count: 0, name: 'a', items: ['x'] }, { items: (a, b) => a.join() === b.join() });
    const seen: { count: number; countBefore: number; itemsKept: boolean }[] = [];
    store.watch(['count', 'items'], (view, before) => seen.push({ count: view.count, countBefore: before.count, itemsKept: view.items === before.items }));
    store.set({ count: 1 });
    // Equal, so stored without telling; then, to whoever compares, not a change.
    store.set({ items: ['x'] });
    store.set({ count: 2 });
    store.set({ items: ['y'] });
    expect(seen).toEqual([
      { count: 1, countBefore: 0, itemsKept: true },
      { count: 2, countBefore: 1, itemsKept: true },
      { count: 2, countBefore: 2, itemsKept: false },
    ]);
  });

  it('hands each watcher what moved since its own last call, so one told twice in a round is not handed again what it already drew', () => {
    const store = fresh();
    const second: string[] = [];
    store.watch(['count'], (view) => {
      if (view.count === 1) store.set({ name: 'from first' });
    });
    store.watch(['count', 'name'], (view, before) => second.push(`${before.count}→${view.count} ${before.name}→${view.name}`));
    store.set({ count: 1 });
    expect(second).toEqual(['0→1 a→from first', '1→1 from first→from first']);
  });

  it('hands a watcher only the slices it is told about as they were, which the compiler holds it to', () => {
    const store = fresh();
    store.watch(
      ['count'],
      (_view, before) => {
        expect(before.count).toBe(0);
        // @ts-expect-error — `name` is read without being told, so there is no last value of it to hand over.
        expect(before.name).toBeUndefined();
      },
      { reads: ['name'] },
    );
    store.set({ count: 1 });
  });

  it('leaves out of a read every slice written since it asked, and writes the rest, telling only about those', () => {
    const store = fresh();
    const told: string[] = [];
    store.watch(['count'], (view) => told.push(`count ${view.count}`));
    store.watch(['name'], (view) => told.push(`name ${view.name}`));
    const readAt = store.stamp();
    store.set({ count: 5 });
    store.set({ count: 1, name: 'read' }, { readAt });
    expect(store.get()).toMatchObject({ count: 5, name: 'read' });
    expect(told).toEqual(['count 5', 'name read']);
  });

  it('keeps what a read wrote over it only until a read asked later, or a plain write, comes along', () => {
    const store = fresh();
    const first = store.stamp();
    const second = store.stamp();
    // The later one lands first, and the earlier one after it is older than what is there.
    store.set({ name: 'second' }, { readAt: second });
    store.set({ name: 'first' }, { readAt: first });
    expect(store.get().name).toBe('second');
    // The other way round, the later one still wins.
    const third = store.stamp();
    const fourth = store.stamp();
    store.set({ name: 'third' }, { readAt: third });
    store.set({ name: 'fourth' }, { readAt: fourth });
    expect(store.get().name).toBe('fourth');
    store.set({ name: 'now' });
    expect(store.get().name).toBe('now');
  });

  it('tells nothing for a batch that throws, and tells what it changed with the next change', () => {
    const store = fresh();
    const views: string[] = [];
    store.watch(['count', 'name'], (view) => views.push(`${view.count} ${view.name}`));
    expect(() =>
      store.batch(() => {
        store.set({ count: 1 });
        throw new Error('handler failed');
      }),
    ).toThrow('handler failed');
    expect(views).toEqual([]);
    store.set({ name: 'b' });
    expect(views).toEqual(['1 b']);
  });
});
