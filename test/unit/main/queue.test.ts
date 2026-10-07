import { describe, it, expect } from 'vitest';
import { inTurn } from '../../../src/main/queue';

/** A job that is held until `release` is called, and records when it starts and ends. */
function held(name: string, log: string[]): { job: () => Promise<string>; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return {
    job: async () => {
      log.push(`${name} starts`);
      await gate;
      log.push(`${name} ends`);
      return name;
    },
    release: () => release(),
  };
}

describe('one job at a time per file', () => {
  it('starts a job only once the one queued before it for the same file is done', async () => {
    const log: string[] = [];
    const first = held('first', log);
    const second = held('second', log);
    const a = inTurn('/f', first.job);
    const b = inTurn('/f', second.job);
    await Promise.resolve();
    expect(log).toEqual(['first starts']);
    second.release();
    first.release();
    expect(await Promise.all([a, b])).toEqual(['first', 'second']);
    expect(log).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
  });

  it('goes on after a job that failed, and its caller hears of the failure', async () => {
    const failed = inTurn('/g', () => Promise.reject(new Error('disk full')));
    const next = inTurn('/g', () => Promise.resolve('next'));
    await expect(failed).rejects.toThrow('disk full');
    expect(await next).toBe('next');
  });

  it('does not hold one file’s job behind another file’s', async () => {
    const log: string[] = [];
    const slow = held('slow', log);
    const elsewhere = inTurn('/other', () => Promise.resolve('elsewhere'));
    const blocked = inTurn('/h', slow.job);
    expect(await elsewhere).toBe('elsewhere');
    slow.release();
    expect(await blocked).toBe('slow');
  });
});
