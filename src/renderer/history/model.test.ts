import { describe, it, expect } from 'vitest';
import type { Exchange, ReplyPart } from '../../shared/types';
import { applySlice, emptyModel, replyBlocks, requestLabel, toolSummary } from './model';

const ex = (request: string, reply = ''): Exchange => ({ id: request, time: '', request, kind: 'typed', replaced: false, parts: reply ? [{ kind: 'text', id: `${request}-reply`, time: '', text: reply }] : [] });

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

describe('replyBlocks', () => {
  const text = (id: string): ReplyPart => ({ kind: 'text', id, time: '', text: id });
  const tool = (name: string, detail = ''): ReplyPart => ({ kind: 'tool', name, detail });
  const shape = (parts: ReplyPart[]): string[] => replyBlocks(parts).map((b) => (b.kind === 'text' ? b.part.id : b.kind === 'tool' ? b.part.name : `${b.at}:[${b.parts.map((p) => p.name).join(',')}]`));

  it('folds a run of two or more tool calls between messages, keyed by where it starts', () => {
    expect(shape([text('a'), tool('Bash'), tool('Read'), tool('Bash'), text('b')])).toEqual(['a', '1:[Bash,Read,Bash]', 'b']);
  });

  it('leaves a lone tool call as itself', () => {
    expect(shape([text('a'), tool('Bash'), text('b'), tool('Read')])).toEqual(['a', 'Bash', 'b', 'Read']);
  });

  it('keeps an edit on its own line, ending the run before it', () => {
    expect(shape([tool('Read'), tool('Bash'), tool('Edit'), tool('Bash'), tool('Write'), tool('Bash'), tool('Read')])).toEqual(['0:[Read,Bash]', 'Edit', 'Bash', 'Write', '5:[Bash,Read]']);
  });
});

describe('toolSummary', () => {
  const tools = (...names: string[]) => names.map((name) => ({ kind: 'tool' as const, name, detail: '' }));

  it("names what the run did in claude's words, in the order the tools first came", () => {
    expect(toolSummary(tools('Read', 'Bash', 'Bash', 'Bash', 'Bash'))).toBe('Read 1 file, ran 4 shell commands');
    expect(toolSummary(tools('Bash', 'Read', 'Read'))).toBe('Ran 1 shell command, read 2 files');
  });

  it('counts tools that share a phrase together', () => {
    expect(toolSummary(tools('Grep', 'Glob', 'Grep'))).toBe('Searched for 3 patterns');
  });

  it('names any other tool by its name and count', () => {
    expect(toolSummary(tools('Bash', 'Bash', 'SendMessage', 'SendMessage', 'ToolSearch'))).toBe('Ran 2 shell commands, SendMessage ×2, ToolSearch ×1');
  });
});

describe('requestLabel', () => {
  it('is the first line that has something on it, cut long', () => {
    expect(requestLabel('\n  fix the sniff  \nand the tests')).toBe('fix the sniff');
    expect(requestLabel('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
