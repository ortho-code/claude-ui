import type { IconName } from '../icons';
import { optionProblems, optionsOf } from '../options';
import type { MountedPanel, PanelHost, PanelStatus, PanelType } from './command';

/**
 * The app's own surfaces as panels: `sessions` is the whole sidebar (switcher, actions, filter, list, attention strip) and `claude` is the terminal area (tab bar and terminals, in types/claude/).
 *
 * Each is ONE element for the run, moved into the group that places it and parked in a hidden holder when the layout lets go of it — never rebuilt and never disposed, so a re-render on a layout change keeps every running session and its xterm exactly as they were.
 * The sidebar is still the element index.html has always held, until it becomes a type of its own, one surface at a time.
 * Both are `singleton` (the layout must place each exactly once, which the validator enforces) and `bare` (each carries its own top bar, so a group holding only it draws no header).
 */

type BuiltinName = 'sessions' | 'claude';

/** The host of each built-in on screen, and the last status the renderer reported for it: a status can arrive before the panel is mounted, and must be there when it is. */
const hosts = new Map<BuiltinName, PanelHost>();
const statuses = new Map<BuiltinName, PanelStatus>();

/**
 * What a built-in's rail icon should say, reported by the code that knows: `sessions` waits while any session anywhere waits for you (the switcher's roll-up), `claude` while one of the tabs on show does (its own watcher, claude/index.ts).
 * Kept here as well as handed on, since a report can arrive before the built-in is mounted.
 */
export function reportBuiltinStatus(name: BuiltinName, status: PanelStatus): void {
  if (statuses.get(name) === status) return;
  statuses.set(name, status);
  hosts.get(name)?.setStatus(status);
}

/**
 * A built-in's host as of its current mount, which its surface asks the other surface through (`Asks`).
 * The tree mounts both built-ins as it first draws, at load, before anything in either can ask; a built-in is never left unmounted, since the layout must place it.
 */
export function hostOf(name: BuiltinName): PanelHost {
  const host = hosts.get(name);
  if (!host) throw new Error(`The ${name} panel was asked for its host before the layout placed it.`);
  return host;
}

/** A built-in's type, around the one element it is for the run: every mount puts that element back, so a remount — a new id, an option — keeps whatever runs in it. */
export function builtinType(name: BuiltinName, el: HTMLElement, title: string, icon: IconName): PanelType {
  const type: PanelType = {
    name,
    options: [],
    exactlyOne: [],
    icon,
    bare: true,
    singleton: true,
    defaultTitle: () => title,
    mount: (slot, host): MountedPanel => {
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

export const sessionsType = builtinType('sessions', document.getElementById('sidebar')!, 'Sessions', 'sessions');
