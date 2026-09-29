import { describe, it, expect } from 'vitest';
import { dragTop, entryAt, grabAt, wheelSteps, type MarkAt } from './marks';

// Three exchanges on a 100px bar: requests at 0, 40 and 70, replies from 10, 50, and none for the last.
const marks: MarkAt[] = [
  { k: 0, request: 0, reply: 10 },
  { k: 1, request: 40, reply: 50 },
  { k: 2, request: 70, reply: null },
];

describe('entryAt', () => {
  it('is a request near its tick', () => {
    expect(entryAt(marks, 0)).toEqual({ k: 0, part: 'request' });
    expect(entryAt(marks, 9)).toEqual({ k: 0, part: 'request' });
    expect(entryAt(marks, 42)).toEqual({ k: 1, part: 'request' });
  });

  it('is the reply once the pointer is on its bar', () => {
    expect(entryAt(marks, 20)).toEqual({ k: 0, part: 'reply' });
    expect(entryAt(marks, 60)).toEqual({ k: 1, part: 'reply' });
  });

  it('takes the next request from a few pixels above its tick', () => {
    expect(entryAt(marks, 38.5)).toEqual({ k: 1, part: 'request' });
    expect(entryAt(marks, 36.5)).toEqual({ k: 1, part: 'request' });
    expect(entryAt(marks, 35.5)).toEqual({ k: 0, part: 'reply' });
  });

  it('is the request of an exchange with no reply, all the way down', () => {
    expect(entryAt(marks, 95)).toEqual({ k: 2, part: 'request' });
  });

  it('keeps the request 5px below its tick even when the reply starts at once', () => {
    expect(entryAt([{ k: 0, request: 0, reply: 0 }], 5)).toEqual({ k: 0, part: 'request' });
    expect(entryAt([{ k: 0, request: 0, reply: 0 }], 6)).toEqual({ k: 0, part: 'reply' });
  });

  it('splits the room between two requests closer than a target', () => {
    const close: MarkAt[] = [{ k: 0, request: 0, reply: 1 }, { k: 1, request: 6, reply: 7 }];
    expect(entryAt(close, 1)).toEqual({ k: 0, part: 'request' });
    expect(entryAt(close, 3)).toEqual({ k: 1, part: 'request' });
  });

  it('keeps the index of an exchange left off the bar', () => {
    expect(entryAt([{ k: 5, request: 0, reply: null }, { k: 9, request: 50, reply: 60 }], 70)).toEqual({ k: 9, part: 'reply' });
  });

  it('is nothing on an empty bar', () => {
    expect(entryAt([], 10)).toBeNull();
  });
});

describe('wheelSteps', () => {
  it('steps one per notch of a mouse wheel, whatever its size', () => {
    expect(wheelSteps(0, 100, 0)).toEqual({ steps: 1, carry: 0 });
    expect(wheelSteps(0, -240, 0)).toEqual({ steps: -1, carry: 0 });
    expect(wheelSteps(1, 3, 0)).toEqual({ steps: 1, carry: 0 });
  });

  it('adds a trackpad up to one step per 30px, carrying the rest', () => {
    let state = { steps: 0, carry: 0 };
    let total = 0;
    for (let i = 0; i < 9; i++) {
      state = wheelSteps(0, 10, state.carry);
      total += state.steps;
    }
    expect(total).toBe(3);
    expect(state.carry).toBeCloseTo(0);
  });

  it('does nothing for a sideways scroll', () => {
    expect(wheelSteps(0, 0, 0.5)).toEqual({ steps: 0, carry: 0.5 });
  });
});

describe('dragging the band', () => {
  const band = { top: 0.4, height: 0.2 };

  it('holds the band where it was pressed on it', () => {
    expect(grabAt(0.45, band, true)).toBeCloseTo(0.05);
    expect(dragTop(0.75, 0.05, band)).toBeCloseTo(0.7);
  });

  it('centres the band on the pointer when pressed elsewhere, or while there is no band', () => {
    expect(grabAt(0.1, band, true)).toBeCloseTo(0.1);
    expect(grabAt(0.45, band, false)).toBeCloseTo(0.1);
    expect(dragTop(0.3, 0.1, band)).toBeCloseTo(0.2);
  });

  it('never goes past either end', () => {
    expect(dragTop(0.02, 0.1, band)).toBe(0);
    expect(dragTop(1.3, 0.1, band)).toBeCloseTo(0.8);
  });
});
