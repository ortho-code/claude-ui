import { describe, it, expect } from 'vitest';
import { leaveAction, leaveLabel, leaveUnderWay, notLeftWords, tabButton } from '../../../../src/renderer/rules/claude';

describe('notLeftWords', () => {
  const LIVE = 3;

  it('says a stop has not left once it has gone on long enough', () => {
    expect(notLeftWords({ terminalId: LIVE, stopping: true, forceable: true, notLeft: true })).toBe("hasn't left");
  });

  it('says nothing before then, or for a tab not stopping', () => {
    expect(notLeftWords({ terminalId: LIVE, stopping: true, forceable: true })).toBe(null);
    expect(notLeftWords({ terminalId: LIVE, notLeft: true })).toBe(null);
    expect(notLeftWords({ terminalId: null })).toBe(null);
  });
});

describe('leaveLabel', () => {
  it("names each leave item, as the button's tooltip says it where it says only that", () => {
    expect(leaveLabel('stop')).toBe('Stop session');
    expect(leaveLabel('close')).toBe('Close tab');
    expect(leaveLabel('finish')).toBe('Finished');
    expect(tabButton({ terminalId: 7 })?.tooltip).toBe(leaveLabel('stop'));
    expect(tabButton({ terminalId: null })?.tooltip).toBe(leaveLabel('close'));
  });
});

// A running tab's process; any id will do.
const LIVE = 7;
const FORCE_WHY = ': claude has not left yet — it may be asking you something';

describe('leaveUnderWay', () => {
  it('names what a leaving tab leaves for, by what its exit does', () => {
    expect(leaveUnderWay({ terminalId: LIVE })).toBe(null);
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true })).toBe('stop');
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true, onExit: 'cool' })).toBe('stop');
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true, onExit: 'close' })).toBe('close');
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true, onExit: 'finish' })).toBe('finish');
  });
});

describe('leaveAction', () => {
  it('offers each of the three on a running tab, each its own press', () => {
    expect(leaveAction({ terminalId: LIVE }, 'stop')).toEqual({ disabled: false, tooltip: 'Stop session', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(leaveAction({ terminalId: LIVE }, 'close')).toEqual({ disabled: false, tooltip: 'Close tab', mark: 'close', label: 'Close tab', action: 'close' });
    expect(leaveAction({ terminalId: LIVE }, 'finish')).toEqual({ disabled: false, tooltip: 'Finished', mark: 'finish', label: 'Finished', action: 'finish' });
  });

  it('has nothing to stop on a cold tab, which closes and finishes at once', () => {
    expect(leaveAction({ terminalId: null }, 'stop')).toEqual({ disabled: true, tooltip: 'Not running', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(leaveAction({ terminalId: null }, 'close').disabled).toBe(false);
    expect(leaveAction({ terminalId: null }, 'finish').disabled).toBe(false);
  });

  it('refuses every item while the tab starts, ARRIVING winning over a leave it also carries', () => {
    for (const action of ['stop', 'close', 'finish'] as const) {
      expect(leaveAction({ terminalId: null, starting: true }, action)).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: action });
      expect(leaveAction({ terminalId: null, starting: true, stopping: true }, action)).toMatchObject({ disabled: true, tooltip: 'Starting…' });
    }
  });

  it("makes the item of what was asked its force, unavailable for its first moment and named for it", () => {
    expect(leaveAction({ terminalId: LIVE, stopping: true }, 'stop')).toEqual({ disabled: true, tooltip: 'Stopping…', mark: 'stop', label: 'Force stop', action: 'stop' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'close' }, 'close')).toEqual({ disabled: true, tooltip: 'Closing…', mark: 'close', label: 'Force close', action: 'close' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'finish' }, 'finish')).toEqual({ disabled: true, tooltip: 'Finishing…', mark: 'finish', label: 'Force finish', action: 'finish' });
  });

  it('offers the force once it may, saying claude may be asking', () => {
    expect(leaveAction({ terminalId: LIVE, stopping: true, forceable: true }, 'stop')).toEqual({ disabled: false, tooltip: `Force stop${FORCE_WHY}`, mark: 'force-stop', label: 'Force stop', action: 'stop' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'close' }, 'close')).toEqual({ disabled: false, tooltip: `Force close${FORCE_WHY}`, mark: 'force-close', label: 'Force close', action: 'close' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'finish' }, 'finish')).toEqual({ disabled: false, tooltip: `Force finish${FORCE_WHY}`, mark: 'force-finish', label: 'Force finish', action: 'finish' });
    // Only a leave on its way can become a force.
    expect(leaveAction({ terminalId: LIVE, forceable: true }, 'stop')).toMatchObject({ disabled: false, mark: 'stop', label: 'Stop session' });
  });

  it('lets every other item change what the exit does, a stop turning a close or a finish back', () => {
    expect(leaveAction({ terminalId: LIVE, stopping: true }, 'close')).toMatchObject({ disabled: false, mark: 'close', label: 'Close tab' });
    expect(leaveAction({ terminalId: LIVE, stopping: true }, 'finish')).toMatchObject({ disabled: false, mark: 'finish', label: 'Finished' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'close' }, 'stop')).toMatchObject({ disabled: false, mark: 'stop', label: 'Stop session' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'finish' }, 'close')).toMatchObject({ disabled: false, mark: 'close', label: 'Close tab' });
    // Forced, the exit can still be changed: claude is going whatever it is asked.
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'close' }, 'finish').disabled).toBe(false);
  });
});

describe('tabButton', () => {
  it('stops a settled session', () => {
    expect(tabButton({ terminalId: LIVE })).toEqual({ disabled: false, tooltip: 'Stop session', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(tabButton({ terminalId: LIVE, starting: false, stopping: false })).toMatchObject({ disabled: false, mark: 'stop' });
  });

  it('refuses both ends of a session lifetime, and says which end it is', () => {
    expect(tabButton({ terminalId: null, starting: true })).toEqual({ disabled: true, tooltip: 'Starting…', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(tabButton({ terminalId: LIVE, stopping: true })).toEqual({ disabled: true, tooltip: 'Stopping…', mark: 'stop', label: 'Force stop', action: 'stop' });
  });

  it('reports ARRIVING when a tab somehow carries both flags', () => {
    // The precedence is load-bearing: a tab that is both is one being started, and calling it "Stopping…" would tell the user the opposite of what is happening.
    expect(tabButton({ terminalId: null, starting: true, stopping: true })).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: 'stop' });
  });

  it('is the force of whatever claude is leaving for, so it stays the press that ends claude', () => {
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true })).toMatchObject({ disabled: false, mark: 'force-stop', action: 'stop' });
    expect(tabButton({ terminalId: LIVE, stopping: true, onExit: 'close' })).toMatchObject({ disabled: true, tooltip: 'Closing…', mark: 'close', action: 'close' });
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'close' })).toMatchObject({ disabled: false, mark: 'force-close', label: 'Force close', action: 'close' });
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'finish' })).toMatchObject({ disabled: false, mark: 'force-finish', label: 'Force finish', action: 'finish' });
  });

  it('closes a cold tab, which has nothing to stop, or finishes it when the choice ends in that', () => {
    expect(tabButton({ terminalId: null })).toEqual({ disabled: false, tooltip: 'Close tab', mark: 'close', label: 'Close tab', action: 'close' });
    expect(tabButton({ terminalId: null }, 'stop-finish')).toEqual({ disabled: false, tooltip: 'Finished', mark: 'finish', label: 'Finished', action: 'finish' });
    expect(tabButton({ terminalId: null }, 'close')).toMatchObject({ mark: 'close', action: 'close' });
    expect(tabButton({ terminalId: null }, 'finish')).toMatchObject({ mark: 'finish', action: 'finish' });
    // A running tab stops while the choice stops first.
    expect(tabButton({ terminalId: LIVE }, 'stop-finish')).toMatchObject({ mark: 'stop', action: 'stop' });
  });

  it('closes or finishes a running tab in one press when the choice skips the stop, and says so while it starts', () => {
    expect(tabButton({ terminalId: LIVE }, 'close')).toEqual({ disabled: false, tooltip: 'Close tab', mark: 'close', label: 'Close tab', action: 'close' });
    expect(tabButton({ terminalId: LIVE }, 'finish')).toEqual({ disabled: false, tooltip: 'Finished', mark: 'finish', label: 'Finished', action: 'finish' });
    expect(tabButton({ terminalId: null, starting: true }, 'finish')).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: 'finish' });
    // Leaving, it is the force of what claude is leaving for, whichever the choice.
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'close' }, 'close')).toMatchObject({ disabled: false, mark: 'force-close' });
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true }, 'finish')).toMatchObject({ disabled: false, mark: 'force-stop' });
  });

  it("cannot finish while another tab of its session is starting, as the menu's Finished cannot, and can still stop or close", () => {
    expect(tabButton({ terminalId: null, sessionStarting: true }, 'stop-finish')).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: 'finish' });
    expect(tabButton({ terminalId: LIVE, sessionStarting: true }, 'finish')).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: 'finish' });
    expect(tabButton({ terminalId: LIVE, sessionStarting: true }, 'stop-finish')).toMatchObject({ disabled: false, mark: 'stop' });
    expect(tabButton({ terminalId: null, sessionStarting: true })).toMatchObject({ disabled: false, mark: 'close' });
  });

  it('is no button for none, running, cold or leaving', () => {
    expect(tabButton({ terminalId: LIVE }, 'none')).toBeNull();
    expect(tabButton({ terminalId: null }, 'none')).toBeNull();
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true }, 'none')).toBeNull();
  });
});
