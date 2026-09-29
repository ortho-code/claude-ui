import { describe, it, expect } from 'vitest';
import type { Exchange } from '../../shared/types';
import { applySlice, emptyModel, requestLabel } from './model';

const ex = (request: string, reply = ''): Exchange => ({ id: request, time: '', request, kind: 'typed', replaced: false, parts: reply ? [{ kind: 'text', text: reply }] : [] });

describe('applySlice', () => {
  it('takes the first read whole', () => {
    const model = emptyModel();
    expect(applySlice(model, { generation: 1, from: 0, exchanges: [ex('a'), ex('b')], total: 2 })).toBe(0);
    expect(model.exchanges.map((e) => e.request)).toEqual(['a', 'b']);
  });

  it('replaces the last exchange it held and appends the rest, saying where the change starts', () => {
    const model = emptyModel();
    applySlice(model, { generation: 1, from: 0, exchanges: [ex('a', 'A'), ex('b')], total: 2 });
    expect(applySlice(model, { generation: 1, from: 1, exchanges: [ex('b', 'B'), ex('c')], total: 3 })).toBe(1);
    expect(model.exchanges.map((e) => `${e.request}${e.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('')}`)).toEqual(['aA', 'bB', 'c']);
  });

  it('drops everything held when the transcript was read again from the start', () => {
    const model = emptyModel();
    applySlice(model, { generation: 1, from: 0, exchanges: [ex('a'), ex('b')], total: 2 });
    expect(applySlice(model, { generation: 2, from: 0, exchanges: [ex('new')], total: 1 })).toBe(0);
    expect(model.exchanges.map((e) => e.request)).toEqual(['new']);
  });
});

describe('requestLabel', () => {
  it('is the first line that has something on it, cut long', () => {
    expect(requestLabel('\n  fix the sniff  \nand the tests')).toBe('fix the sniff');
    expect(requestLabel('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
