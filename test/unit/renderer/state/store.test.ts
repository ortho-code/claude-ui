import { describe, it, expect } from 'vitest';

import { createStore } from '../../../../src/renderer/state/store';

interface Shape {
  count: number;
  name: string;
  items: string[];
}

const fresh = (): ReturnType<typeof createStore<Shape>> => createStore<Shape>({ count: 0, name: 'a', items: [] });

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

  it('tells every watcher even when one throws, and throws the first failure after', () => {
    const store = fresh();
    const told: string[] = [];
    store.watch(['count'], () => {
      throw new Error('first failed');
    });
    store.watch(['count'], () => told.push('second'));
    expect(() => store.set({ count: 1 })).toThrow('first failed');
    expect(told).toEqual(['second']);
  });

  it('stops two watchers that keep changing each other, rather than looping', () => {
    const store = fresh();
    store.watch(['count'], (view) => store.set({ name: String(view.count) }));
    store.watch(['name'], (view) => store.set({ count: Number(view.name) + 1 }));
    expect(() => store.set({ count: 1 })).toThrow(/kept changing/);
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
