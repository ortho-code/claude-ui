import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { resolveContext, endLabel, runFailed, RunGate, placement, runKey, runContext } from '../../../../src/renderer/panels/run';

describe('RunGate', () => {
  /** A gate over a context the test moves by hand, counting the runs it lets through. */
  function gate(start = '/repo') {
    const state = { context: start, runs: [] as string[] };
    const g = new RunGate(
      () => state.context,
      () => state.runs.push(state.context),
    );
    return { g, state };
  }

  it('runs nothing while mounted hidden, and runs on first being shown', () => {
    const { g, state } = gate();
    g.contextChanged();
    expect(state.runs).toEqual([]);
    g.setVisible(true);
    expect(state.runs).toEqual(['/repo']);
  });

  it('runs on a context change while shown, and not on one that lands where it was', () => {
    const { g, state } = gate();
    g.setVisible(true);
    state.context = '/other';
    g.contextChanged();
    g.contextChanged();
    expect(state.runs).toEqual(['/repo', '/other']);
  });

  it('holds a change made while hidden and runs it once on reveal', () => {
    const { g, state } = gate();
    g.setVisible(true);
    g.setVisible(false);
    state.context = '/a';
    g.contextChanged();
    state.context = '/b';
    g.contextChanged();
    expect(state.runs).toEqual(['/repo']);
    g.setVisible(true);
    expect(state.runs).toEqual(['/repo', '/b']);
  });

  it('does not run on reveal when the context came back to where the last run was', () => {
    const { g, state } = gate();
    g.setVisible(true);
    g.setVisible(false);
    state.context = '/a';
    g.contextChanged();
    state.context = '/repo';
    g.contextChanged();
    g.setVisible(true);
    expect(state.runs).toEqual(['/repo']);
  });

  it('runs on Refresh whatever the context, and counts that run as the last', () => {
    const { g, state } = gate();
    g.setVisible(true);
    g.refresh();
    expect(state.runs).toEqual(['/repo', '/repo']);
    g.setVisible(false);
    g.setVisible(true);
    expect(state.runs).toHaveLength(2);
  });

  it('runs again on rerun in the same context: now if shown, on reveal if not', () => {
    const { g, state } = gate();
    g.setVisible(true);
    g.rerun();
    expect(state.runs).toEqual(['/repo', '/repo']);
    g.setVisible(false);
    g.rerun();
    expect(state.runs).toHaveLength(2);
    g.setVisible(true);
    expect(state.runs).toHaveLength(3);
  });

  it('says whether showing or hiding the panel let a run through', () => {
    const { g } = gate();
    expect(g.setVisible(false)).toBe(false);
    expect(g.setVisible(true)).toBe(true);
    expect(g.setVisible(false)).toBe(false);
    expect(g.setVisible(true)).toBe(false);
  });

  it('holds only the latest run let through as the latest, so an overtaken one can drop out', () => {
    const numbers: number[] = [];
    const g = new RunGate(
      () => '/repo',
      (number) => numbers.push(number),
    );
    g.refresh();
    g.refresh();
    expect(numbers.map((number) => g.isLatest(number))).toEqual([false, true]);
  });

  describe('on an interval', () => {
    const MINUTE = 60_000;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** A gate ticking every minute, or on no interval with null, and `end` for the end of the latest run it let through. */
    function ticking(ms: number | null = MINUTE) {
      const state = { context: '/repo', runs: [] as string[], numbers: [] as number[] };
      const g = new RunGate(
        () => state.context,
        (number) => {
          state.runs.push(state.context);
          state.numbers.push(number);
        },
        () => ms,
      );
      const end = (): void => g.ended(state.numbers.at(-1)!);
      return { g, state, end };
    }

    it('runs when the tree goes live though hidden, which a panel without one does not', () => {
      const { g, state } = ticking();
      g.setVisible(false);
      expect(state.runs).toEqual(['/repo']);
      const plain = ticking(null);
      plain.g.setVisible(false);
      expect(plain.state.runs).toEqual([]);
    });

    it('runs again a tick after a run ends, while hidden too, and counts the tick from the end', () => {
      const { g, state, end } = ticking();
      g.setVisible(false);
      vi.advanceTimersByTime(5 * MINUTE);
      expect(state.runs).toHaveLength(1);
      end();
      vi.advanceTimersByTime(MINUTE - 1);
      expect(state.runs).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(state.runs).toHaveLength(2);
      // Not again until that run has ended.
      vi.advanceTimersByTime(5 * MINUTE);
      expect(state.runs).toHaveLength(2);
    });

    it('sets no tick without an interval, nor once stopped', () => {
      const plain = ticking(null);
      plain.g.setVisible(true);
      plain.end();
      vi.advanceTimersByTime(60 * MINUTE);
      expect(plain.state.runs).toHaveLength(1);
      const { g, state, end } = ticking();
      g.setVisible(true);
      end();
      g.stop();
      end();
      vi.advanceTimersByTime(60 * MINUTE);
      expect(state.runs).toHaveLength(1);
    });

    it('drops a tick still waiting when a press or a switch runs it, and counts the next from the end after', () => {
      const { g, state, end } = ticking();
      g.setVisible(true);
      end();
      vi.advanceTimersByTime(MINUTE / 2);
      g.refresh();
      vi.advanceTimersByTime(MINUTE);
      expect(state.runs).toEqual(['/repo', '/repo']);
      end();
      vi.advanceTimersByTime(MINUTE / 2);
      state.context = '/other';
      g.contextChanged();
      vi.advanceTimersByTime(MINUTE);
      expect(state.runs).toEqual(['/repo', '/repo', '/other']);
      end();
      vi.advanceTimersByTime(MINUTE);
      expect(state.runs).toEqual(['/repo', '/repo', '/other', '/other']);
    });

    it('counts no tick from the end of a run that a later one replaced', () => {
      const { g, state, end } = ticking();
      g.setVisible(true);
      const replaced = state.numbers.at(-1)!;
      g.refresh();
      // The replaced run's end arrives after the run that replaced it was let through.
      g.ended(replaced);
      vi.advanceTimersByTime(5 * MINUTE);
      expect(state.runs).toHaveLength(2);
      end();
      vi.advanceTimersByTime(MINUTE);
      expect(state.runs).toHaveLength(3);
    });

    it('runs at once on rerun though hidden, as it would have all along', () => {
      const { g, state } = ticking();
      g.setVisible(false);
      g.rerun();
      expect(state.runs).toHaveLength(2);
    });
  });
});

describe('resolveContext', () => {
  it('runs in the active tab’s cwd, so a worktree session’s panel reports the worktree', () => {
    expect(resolveContext({ tab: { cwd: '/repo/.worktrees/x', repoRoot: '/repo', id: 's1' }, project: '/repo' })).toEqual({
      projectRoot: '/repo',
      cwd: '/repo/.worktrees/x',
      sessionId: 's1',
    });
  });

  it('falls back to the selected project’s root with no tab, and to nothing with neither', () => {
    expect(resolveContext({ tab: null, project: '/repo' })).toEqual({ projectRoot: '/repo', cwd: '/repo', sessionId: '' });
    expect(resolveContext({ tab: null, project: null })).toBeNull();
  });

  it('prefers the tab over the project even when the tab belongs to another project (the All view)', () => {
    expect(resolveContext({ tab: { cwd: '/other', repoRoot: '/other', id: 's2' }, project: null })?.cwd).toBe('/other');
  });
});

describe('placement', () => {
  const context = { projectRoot: '/repo', cwd: '/repo/.worktrees/x', sessionId: 's1' };

  it('runs in the context directory without a cwd, and nowhere without a context', () => {
    expect(placement(undefined, context)).toEqual({ kind: 'context' });
    expect(placement(undefined, null)).toBeNull();
  });

  it('runs a fixed cwd there whatever is selected, with or without a context', () => {
    expect(placement('/srv/app', context)).toEqual({ kind: 'fixed', value: '/srv/app' });
    expect(placement('~/notes', null)).toEqual({ kind: 'fixed', value: '~/notes' });
  });

  it('runs a relative cwd under the context directory, and nowhere without a context', () => {
    expect(placement('packages/api', context)).toEqual({ kind: 'under', value: 'packages/api' });
    expect(placement('packages/api', null)).toBeNull();
  });
});

describe('runKey', () => {
  const inRepo = (cwd: string, sessionId: string) => ({ projectRoot: '/repo', cwd, sessionId });

  it('keys a panel without a cwd on the whole context, as it always was', () => {
    expect(runKey(undefined, inRepo('/repo', 's1'))).not.toBe(runKey(undefined, inRepo('/repo', 's2')));
  });

  it('never changes for a fixed cwd, so no switch runs it again', () => {
    const key = runKey('~/fixed', inRepo('/repo', 's1'));
    expect(runKey('~/fixed', inRepo('/other', 's2'))).toBe(key);
    expect(runKey('~/fixed', null)).toBe(key);
  });

  it('changes for a relative cwd only when the folder it lands in does, not on a tab switch within it', () => {
    const key = runKey('sub', inRepo('/repo', 's1'));
    expect(runKey('sub', inRepo('/repo', 's2'))).toBe(key);
    expect(runKey('sub', inRepo('/repo/.worktrees/x', 's3'))).not.toBe(key);
    expect(runKey('sub', null)).toBe('');
  });
});

describe('runContext', () => {
  it('hands on the selection with the folder the panel actually runs in, so CLAUDE_UI_CWD tells the truth', () => {
    expect(runContext({ projectRoot: '/repo', cwd: '/repo', sessionId: 's1' }, '/home/u/fixed')).toEqual({ projectRoot: '/repo', cwd: '/home/u/fixed', sessionId: 's1' });
  });

  it('gives a fixed panel with nothing selected empty project and session variables', () => {
    expect(runContext(null, '/home/u/fixed')).toEqual({ projectRoot: '', cwd: '/home/u/fixed', sessionId: '' });
  });
});

describe('endLabel', () => {
  it('says nothing about a run that ended well', () => {
    expect(endLabel({ kind: 'exit', code: 0, signal: null })).toBe('');
  });

  it('names the exit code, the signal, or the failure to start', () => {
    expect(endLabel({ kind: 'exit', code: 3, signal: null })).toBe('exit 3');
    expect(endLabel({ kind: 'exit', code: null, signal: 'SIGSEGV' })).toBe('killed by SIGSEGV');
    expect(endLabel({ kind: 'exit', code: null, signal: null, error: '/gone is not there' })).toBe('/gone is not there');
  });

  it('says why the app stopped a run', () => {
    expect(endLabel({ kind: 'stopped', reason: 'timeout' })).toBe('stopped after 30 s');
    expect(endLabel({ kind: 'stopped', reason: 'truncated' })).toBe('output cut at 1 MB');
    expect(endLabel({ kind: 'truncated' })).toBe('output cut at 1 MB');
    expect(endLabel({ kind: 'stopped', reason: 'request' })).toBe('stopped');
  });
});

describe('runFailed', () => {
  it('marks a non-zero exit, a signal and a failure to start', () => {
    expect(runFailed({ kind: 'exit', code: 3, signal: null })).toBe(true);
    expect(runFailed({ kind: 'exit', code: null, signal: 'SIGSEGV' })).toBe(true);
    expect(runFailed({ kind: 'exit', code: null, signal: null, error: '/gone is not there' })).toBe(true);
  });

  it('marks the timeout and the output cap', () => {
    expect(runFailed({ kind: 'stopped', reason: 'timeout' })).toBe(true);
    expect(runFailed({ kind: 'stopped', reason: 'truncated' })).toBe(true);
    expect(runFailed({ kind: 'truncated' })).toBe(true);
  });

  it('says nothing about a run that ended well, or one the app stopped itself', () => {
    expect(runFailed({ kind: 'exit', code: 0, signal: null })).toBe(false);
    expect(runFailed({ kind: 'stopped', reason: 'rerun' })).toBe(false);
    expect(runFailed({ kind: 'stopped', reason: 'request' })).toBe(false);
    expect(runFailed({ kind: 'stopped', reason: 'quit' })).toBe(false);
    expect(runFailed({ kind: 'output', text: 'x' })).toBe(false);
  });
});
