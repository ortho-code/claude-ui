import { describe, it, expect } from 'vitest';
import { hasVisibleOutput, leaveAction, leaveLabel, leaveUnderWay, notLeftWords, orderAsTabs, reorderWithinGroup, tabButton } from '../../../../src/renderer/rules/claude';

describe('reorderWithinGroup', () => {
  const key = (t: { id: string; g: string }) => t.g;
  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  it('reorders within a single group', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'x' }, c = { id: 'c', g: 'x' };
    expect(ids(reorderWithinGroup([a, b, c], key, a, 2))).toEqual(['b', 'c', 'a']);
  });

  it('leaves other groups in their slots', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'y' }, c = { id: 'c', g: 'x' };
    // Move c to the front of group x; y keeps its slot (index 1).
    expect(ids(reorderWithinGroup([a, b, c], key, c, 0))).toEqual(['c', 'b', 'a']);
  });

  it('clamps the index and no-ops an item that is not present', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'x' };
    expect(ids(reorderWithinGroup([a, b], key, a, 9))).toEqual(['b', 'a']);
    expect(ids(reorderWithinGroup([a, b], key, { id: 'z', g: 'x' }, 0))).toEqual(['a', 'b']);
  });
});

// The exact chunks a starting claude sends, captured from a real pty.
// The loader hides the terminal until something is actually drawn, so a false "visible" here is a pane that flashes and goes empty again — which is what happened when this only tested for the first BYTE.
describe('hasVisibleOutput', () => {
  it('ignores the terminal setup claude sends before drawing anything', () => {
    // ESC 7 and ESC 8 are the trap: two-char escapes whose second byte is a DIGIT, so a stripper that only handles CSI and letter-escapes leaves "7" behind and calls it content.
    expect(hasVisibleOutput('\x1b7\x1b[r\x1b8\x1b[?25h')).toBe(false);
    expect(hasVisibleOutput('\x1b[?25l')).toBe(false);
    expect(hasVisibleOutput('\x1b[?2004h\x1b[?1004h\x1b[?2031h')).toBe(false);
    expect(hasVisibleOutput('\x1b[>0q\x1b[c')).toBe(false);
  });

  it('ignores an OSC window-title sequence and bare whitespace', () => {
    expect(hasVisibleOutput('\x1b]0;claude\x07')).toBe(false);
    expect(hasVisibleOutput('\r\r\n\r\r\n')).toBe(false);
    expect(hasVisibleOutput('')).toBe(false);
  });

  it('reports the first chunk that actually draws', () => {
    expect(hasVisibleOutput('\r\n\x1b[38;2;255;193;7m────\x1b[39m\r\n\x1b[2GAccessing')).toBe(true);
    expect(hasVisibleOutput('hello')).toBe(true);
  });

  it('counts a sequence the chunk ends partway through as nothing yet, and the text after a complete one as content', () => {
    expect(hasVisibleOutput('\x1b]0;claude\x1b[?25l')).toBe(false);
    expect(hasVisibleOutput('\x1b[38;2;25')).toBe(false);
    expect(hasVisibleOutput('\x1bPq#0;2;0;0;0')).toBe(false);
    expect(hasVisibleOutput('\x1b[2GAccessing')).toBe(true);
  });
});

describe('orderAsTabs', () => {
  /** An item to place: its project, its group ('' for none), and a name to assert on. */
  const at = (item: string, repoRoot: string, groupId = '') => ({ repoRoot, groupId, item });
  /** The group registry, in the order the sidebar and the tab bar both use. */
  const groups = (byRoot: Record<string, string[]>) => (root: string) => byRoot[root] ?? [];
  const flat = (out: ReturnType<typeof orderAsTabs<string>>) => out.flatMap((c) => c.items);

  it('follows the given project order', () => {
    const out = orderAsTabs([at('a', '/late'), at('b', '/early')], groups({}), ['/early', '/late']);
    expect(out.map((c) => c.repoRoot)).toEqual(['/early', '/late']);
  });

  // Without a project order, projects come in the order they are met.
  it('falls back to the order projects first appear', () => {
    const out = orderAsTabs([at('a', '/second'), at('b', '/first')], groups({}));
    expect(out.map((c) => c.repoRoot)).toEqual(['/second', '/first']);
  });

  /**
   * The shape the tab bar draws: a project's ungrouped tabs first, then one run per group in REGISTRY order — not the order the tabs happen to sit in.
   */
  it('puts ungrouped items first, then each group in registry order', () => {
    const out = orderAsTabs(
      [at('in-g2', '/repo', 'g2'), at('loose-1', '/repo'), at('in-g1', '/repo', 'g1'), at('loose-2', '/repo')],
      groups({ '/repo': ['g1', 'g2'] }),
    );
    expect(out.map((c) => c.groupId)).toEqual(['', 'g1', 'g2']);
    expect(flat(out)).toEqual(['loose-1', 'loose-2', 'in-g1', 'in-g2']);
  });

  // Within a run, the caller's order is passed through untouched — no recency, no pins, no urgency.
  // Sorting by any of those is what made rows swap while they were being read.
  it('leaves a run in the order it was handed', () => {
    const out = orderAsTabs([at('c', '/repo'), at('a', '/repo'), at('b', '/repo')], groups({}));
    expect(flat(out)).toEqual(['c', 'a', 'b']);
  });

  // Moving a session into a group moves it in the bar.
  it('moves an item when its group changes, without anything else moving', () => {
    const entries = [at('a', '/repo'), at('b', '/repo'), at('c', '/repo')];
    expect(flat(orderAsTabs(entries, groups({ '/repo': ['g1'] })))).toEqual(['a', 'b', 'c']);
    const regrouped = [at('a', '/repo'), at('b', '/repo', 'g1'), at('c', '/repo')];
    expect(flat(orderAsTabs(regrouped, groups({ '/repo': ['g1'] })))).toEqual(['a', 'c', 'b']);
  });

  // A group belonging to another project cannot be drawn under this one; the item is loose here rather than vanishing, which is what the sidebar's tree does too.
  it('treats a group this project does not own as no group at all', () => {
    const out = orderAsTabs([at('a', '/repo', 'group-of-elsewhere')], groups({ '/repo': ['g1'] }));
    expect(out).toEqual([{ repoRoot: '/repo', groupId: '', items: ['a'] }]);
  });

  it('keeps a project the order has never seen, rather than dropping it', () => {
    const out = orderAsTabs([at('a', '/unknown')], groups({}), ['/known']);
    expect(out.map((c) => c.repoRoot)).toEqual(['/unknown']);
  });

  it('omits a group with nothing open in it', () => {
    const out = orderAsTabs([at('a', '/repo')], groups({ '/repo': ['empty-group'] }));
    expect(out.map((c) => c.groupId)).toEqual(['']);
  });
});

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
