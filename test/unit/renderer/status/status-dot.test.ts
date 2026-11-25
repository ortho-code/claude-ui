import { describe, expect, it } from 'vitest';
import { store } from '../../../../src/renderer/state/app';
import { rowStateLines } from '../../../../src/renderer/status/status-dot';
import { wasRunning } from '../fixtures';

const view = (over: Partial<ReturnType<typeof store.get>>): ReturnType<typeof store.get> => ({ ...store.get(), ...over });

describe('rowStateLines', () => {
  it('lists every state a row lists under its title: its status, each reason bare, then its set-aside mark', () => {
    const lines = rowStateLines('a', view({ statuses: new Map([['a', 'busy']]), needsYou: new Map([['a', [wasRunning]]]), setAside: new Map([['a', { due: null, at: 1 }]]) }));
    expect(lines.map((line) => line.text)).toEqual(['Working', 'Was running when the app quit (read)', 'Set aside, whenever']);
  });

  it('says which lines its dot shows read', () => {
    const lines = rowStateLines('a', view({ statuses: new Map([['a', 'waiting']]), acked: new Set(['a']) }));
    expect(lines).toEqual([{ text: 'Waiting for you (read)', read: true }]);
  });

  it("names a PR by its number alone, its title being in the row's tooltip", () => {
    const merged = { type: 'pr.merged', at: 1, pr: 'acme/app#7' } as const;
    const lines = rowStateLines('a', view({ needsYou: new Map([['a', [merged]]]), prNames: new Map([['acme/app#7', { title: 'Build the mail templates' }]]) }));
    expect(lines.map((line) => line.text)).toEqual(['PR #7 merged']);
  });

  it('lists nothing for a session with nothing to report', () => {
    expect(rowStateLines('a', view({}))).toEqual([]);
  });
});
