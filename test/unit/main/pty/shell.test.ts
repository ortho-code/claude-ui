import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// shell.ts logs through log.ts, which reaches electron; nothing here is about the log.
vi.mock('../../../../src/main/logs/log', () => ({ log: () => {} }));

import { inheritedEnv, untilGone } from '../../../../src/main/pty/shell';
import { runMark, RUN_VARIABLE } from '../../../../src/main/pty/leftovers';

describe('inheritedEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("carries this run's id, in place of one inherited from another instance's session", () => {
    vi.stubEnv(RUN_VARIABLE, 'another-run');
    expect(inheritedEnv()[RUN_VARIABLE]).toBe(runMark()[RUN_VARIABLE]);
    expect(runMark()[RUN_VARIABLE]).not.toBe('another-run');
  });
});

/** Whether a promise has settled by now, without waiting for it. */
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

// The quit waits for what it stopped, rather than for a fixed time that the slowest exit would have to fit in.
describe('untilGone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves at once when nothing is running', async () => {
    expect(await settled(untilGone(() => false, 3000))).toBe(true);
  });

  it('resolves as soon as the last of it has gone, not at the end of the budget', async () => {
    let running = true;
    const gone = untilGone(() => running, 3000);
    await vi.advanceTimersByTimeAsync(800);
    expect(await settled(gone)).toBe(false);
    running = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(await settled(gone)).toBe(true);
  });

  it('gives up at the end of the budget, whatever is still running', async () => {
    const gone = untilGone(() => true, 3000);
    await vi.advanceTimersByTimeAsync(2900);
    expect(await settled(gone)).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await settled(gone)).toBe(true);
  });
});
