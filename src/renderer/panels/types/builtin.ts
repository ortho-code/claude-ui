import type { IconName } from '../icons';
import { optionProblems, optionsOf } from '../options';
import type { MountedPanel, PanelHost, PanelStatus, PanelType } from './command';

/**
 * The app's own surfaces as panels: `sessions` is the whole sidebar (switcher, actions, filter, list, attention strip) and `claude` is the terminal area (tab bar and terminals).
 *
 * OPAQUE, for now: each is the element the app has always built, moved into the group that places it and parked in a hidden holder when the layout lets go of it — never rebuilt and never disposed, so a re-render on a layout change keeps every running session and its xterm exactly as they were.
 * Splitting the sidebar into panels of its own is a later slice, one surface at a time.
 * Both are `singleton` (the layout must place each exactly once, which the validator enforces) and `bare` (each carries its own top bar, so a group holding only it draws no header).
 */

type BuiltinName = 'sessions' | 'claude';

/** The host of each built-in on screen, and the last status the renderer reported for it: a status can arrive before the panel is mounted, and must be there when it is. */
const hosts = new Map<BuiltinName, PanelHost>();
const statuses = new Map<BuiltinName, PanelStatus>();

/**
 * The renderer reporting what a built-in's rail icon should say: `sessions` waits while any session anywhere waits for you, `claude` while one of the tabs on show does.
 * The renderer knows that and the surfaces do not, since the surfaces are the renderer's own elements.
 */
export function reportBuiltinStatus(name: BuiltinName, status: PanelStatus): void {
  if (statuses.get(name) === status) return;
  statuses.set(name, status);
  hosts.get(name)?.setStatus(status);
}

function builtin(name: BuiltinName, elementId: string, title: string, icon: IconName): PanelType {
  const type: PanelType = {
    name,
    options: [],
    exactlyOne: [],
    icon,
    bare: true,
    singleton: true,
    defaultTitle: () => title,
    mount: (slot, host): MountedPanel => {
      const el = document.getElementById(elementId)!;
      hosts.set(name, host);
      host.setStatus(statuses.get(name) ?? null);
      // Named as NOTES, never as problems: a built-in cannot be refused, since no file may produce a window without the sidebar or the terminal.
      host.setNotes(optionProblems(optionsOf(slot.entry), type).map((line) => `${slot.key}: ${line}`));
      return {
        el,
        // Nothing to run: the surface keeps itself current, and follows the tab and the project because the renderer drives it directly.
        refresh: () => {},
        contextChanged: () => {},
        // A reveal needs no help: the terminal area refits from its own ResizeObserver once it has a size again.
        setVisible: () => {},
        // Nothing in the config folder is the built-ins' to read.
        recheck: () => {},
        unmount: () => {
          if (hosts.get(name) === host) hosts.delete(name);
          document.getElementById('parked')!.append(el);
        },
      };
    },
  };
  return type;
}

export const sessionsType = builtin('sessions', 'sidebar', 'Sessions', 'sessions');
export const claudeType = builtin('claude', 'terminal-pane', 'Claude', 'claude');
