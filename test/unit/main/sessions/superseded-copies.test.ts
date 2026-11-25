import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', async () => (await import('./sessions-home')).electronStub);
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()),
  ...(await import('./sessions-home')).logStub,
}));
vi.mock('node:os', async () => (await import('./sessions-home')).osStub);

import { listSessions } from '../../../../src/main/sessions/sessions';
import { copyOf, readCopy, supersededCopies } from '../../../../src/main/sessions/superseded-copies';
import { NO_TRANSCRIPT } from '../../../../src/shared/sessions/history';
import { jsonl, projectsDir } from './sessions-home';

const dir = path.join(projectsDir, '-tmp-superseded');

/** A typed request, as the history counts one, under its record id. */
const asked = (uuid: string, text = `request ${uuid}`): Record<string, unknown> => ({ type: 'user', uuid, cwd: '/tmp/superseded', timestamp: '2026-11-23T12:00:00Z', message: { content: text } });
/** A reply, which is no request. */
const answered = (uuid: string): Record<string, unknown> => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text: 'done' }] } });

const file = (name: string): string => path.join(dir, name);

beforeAll(async () => {
  await fs.mkdir(dir, { recursive: true });
  // The current transcript went on from the split, and its copy holds two requests from before it besides the one they share.
  await fs.writeFile(file('split.jsonl'), jsonl(asked('shared'), answered('a1'), asked('after')));
  await fs.writeFile(file('split.jsonl.superseded-1795440916583'), jsonl(asked('before-1'), answered('a2'), asked('before-2'), asked('shared')));
  // Two copies, written out of order, one of them holding nothing the current one lacks.
  await fs.writeFile(file('twice.jsonl'), jsonl(asked('t1'), asked('t2')));
  await fs.writeFile(file('twice.jsonl.superseded-1795440999000'), jsonl(asked('t1'), asked('t2')));
  await fs.writeFile(file('twice.jsonl.superseded-1795440000000'), jsonl(asked('old')));
  // A session with no copy, and names that are no copy.
  await fs.writeFile(file('alone.jsonl'), jsonl(asked('alone')));
  await fs.writeFile(file('alone.jsonl.superseded-soon'), jsonl(asked('not-a-copy')));
  await fs.mkdir(file('alone.superseded-1795440916601'));
});

describe('copyOf', () => {
  it('reads the session and stamp of a superseded copy, and nothing of any other name', () => {
    expect(copyOf('8cee36b4-45da.jsonl.superseded-1795440916583')).toEqual({ id: '8cee36b4-45da', stamp: '1795440916583' });
    expect(copyOf('8cee36b4-45da.jsonl')).toBeNull();
    expect(copyOf('8cee36b4-45da.jsonl.superseded-soon')).toBeNull();
    expect(copyOf('8cee36b4-45da.superseded-1795440916601')).toBeNull();
  });
});

describe('supersededCopies', () => {
  it('counts the requests a copy holds that the current transcript lacks, and no reply', async () => {
    expect(await supersededCopies(file('split.jsonl'), ['1795440916583'])).toEqual([{ stamp: '1795440916583', at: 1795440916583, missing: 2 }]);
  });

  it('counts a request the current transcript gains since as no longer missing', async () => {
    await fs.writeFile(file('grows.jsonl'), jsonl(asked('g1')));
    await fs.writeFile(file('grows.jsonl.superseded-1795440916583'), jsonl(asked('g1'), asked('g2')));
    expect((await supersededCopies(file('grows.jsonl'), ['1795440916583']))[0]?.missing).toBe(1);

    await fs.appendFile(file('grows.jsonl'), jsonl(asked('g2')));
    expect((await supersededCopies(file('grows.jsonl'), ['1795440916583']))[0]?.missing).toBe(0);
  });

  it('reads a current transcript that another file replaced from its start, though the new one is no shorter', async () => {
    await fs.writeFile(file('moved.jsonl'), jsonl(asked('m1')));
    await fs.writeFile(file('moved.jsonl.superseded-1795440916583'), jsonl(asked('m1'), asked('m2')));
    expect((await supersededCopies(file('moved.jsonl'), ['1795440916583']))[0]?.missing).toBe(1);

    // Claude Code moves another copy of the session over it, as a rename onto the name.
    await fs.writeFile(file('moved.incoming'), jsonl(asked('m2'), asked('m1')));
    await fs.rename(file('moved.incoming'), file('moved.jsonl'));
    expect((await supersededCopies(file('moved.jsonl'), ['1795440916583']))[0]?.missing).toBe(0);
  });
});

describe('readCopy', () => {
  it('reads a copy as a history, with the ids of its requests the current transcript lacks', async () => {
    const slice = await readCopy(file('split.jsonl'), '1795440916583', 0, 0);
    expect(slice.exchanges.map((exchange) => exchange.id)).toEqual(['before-1', 'before-2', 'shared']);
    expect(slice.notInCurrent).toEqual(['before-1', 'before-2']);
  });

  it.each([['../split.jsonl'], ['1795440916583/x'], [''], [42]])('reads no history for a stamp that names no copy (%s)', async (stamp) => {
    expect(await readCopy(file('split.jsonl'), stamp, 0, 0)).toEqual(NO_TRANSCRIPT);
  });
});

describe('listSessions', () => {
  it('lists each session’s superseded copies, oldest first, and none for a session without one', async () => {
    const byId = new Map((await listSessions()).map((s) => [s.id, s]));
    expect(byId.get('split')?.supersededCopies).toEqual([{ stamp: '1795440916583', at: 1795440916583, missing: 2 }]);
    expect(byId.get('twice')?.supersededCopies).toEqual([
      { stamp: '1795440000000', at: 1795440000000, missing: 1 },
      { stamp: '1795440999000', at: 1795440999000, missing: 0 },
    ]);
    expect(byId.get('alone')?.supersededCopies).toEqual([]);
  });

  it('drops a copy Claude Code has deleted since, though the transcript beside it is unchanged', async () => {
    await fs.writeFile(file('cleaned.jsonl'), jsonl(asked('c1')));
    await fs.writeFile(file('cleaned.jsonl.superseded-1795440916583'), jsonl(asked('c0')));
    expect((await listSessions()).find((s) => s.id === 'cleaned')?.supersededCopies).toHaveLength(1);

    await fs.rm(file('cleaned.jsonl.superseded-1795440916583'));
    expect((await listSessions()).find((s) => s.id === 'cleaned')?.supersededCopies).toEqual([]);
  });
});
