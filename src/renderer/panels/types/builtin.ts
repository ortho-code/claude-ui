import type { IconName } from '../../../shared/helpers/icons';
import { optionProblems, optionsOf } from '../options';
import type { MountedPanel, PanelHost, PanelType } from '../contract';
import type { NudgeStatus } from '../../status/rollup';
import { isNeeds } from '../../status/shown';
import { lookOf } from '../../status/looks';

/**
 * The app's own surfaces as panels: `sessions` is the whole sidebar (switcher, actions, filter, list, in types/sessions/) and `claude` is the terminal area (tab bar and terminals, in types/claude/).
 *
 * Each is ONE element for the run, which its type builds, moved into the group that places it and parked in a hidden holder when the layout lets go of it — never rebuilt and never disposed, so a re-render on a layout change keeps every running session and its xterm exactly as they were.
 * Both are `singleton` (the layout must place each exactly once, which the validator enforces) and `bare` (each carries its own top bar, so a group holding only it draws no header).
 */

type BuiltinName = 'sessions' | 'claude';

/** The host of each built-in on screen. */
const hosts = new Map<BuiltinName, PanelHost>();

/**
 * A built-in's host as of its current mount, which its surface asks the other surface through (`Asks`).
 * The tree mounts both built-ins as it first draws, at load, before anything in either can ask; a built-in is never left unmounted, since the layout must place it.
 */
export function hostOf(name: BuiltinName): PanelHost {
  const host = hosts.get(name);
  if (!host) throw new Error(`The ${name} panel was asked for its host before the layout placed it.`);
  return host;
}

/** Tell a built-in's rail icon the nudge that speaks for its sessions (`strongestNudge`): waiting, or needs in its type's look for one marked as needing you, and nothing for a turn that finished or work under way, which ask nothing urgent of a panel out of sight. */
export function tellRail(host: PanelHost, nudge: NudgeStatus): void {
  if (isNeeds(nudge)) host.setStatus('needs', lookOf(nudge) ?? undefined);
  else host.setStatus(nudge === 'waiting' ? 'wait' : null);
}

/**
 * A built-in's type, around the one element it is for the run: every mount puts that element back, so a remount — a new id, an option — keeps whatever runs in it.
 * Its rail icon's status is its own to say: a watcher of its own hands each change to its host (`hostOf`), and a mount, which is a new host, takes it as it is now (`railStatus`).
 * `mounted` is handed each new host too, and the host again whenever the view picked for the panel changes without a mount (`viewChanged`), for what else the built-in tells or reads of it, such as the session list's views (sessions/arrangement.ts).
 * Its bar is its own, so its full-screen button goes at the end of `fullScreenSlot` with each mount, in the size `buttonSize` gives the bar's other buttons, and leaves with the mount.
 */
export function builtinType(
  name: BuiltinName,
  el: HTMLElement,
  title: string,
  icon: IconName,
  bar: { fullScreenSlot: HTMLElement; buttonSize: 'compact' | 'large' },
  railStatus: () => NudgeStatus,
  mounted?: (host: PanelHost) => void,
): PanelType {
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
      tellRail(host, railStatus());
      // Named as NOTES, never as problems: a built-in cannot be refused, since no file may produce a window without the sidebar or the terminal.
      host.setNotes(optionProblems(optionsOf(slot.entry), type).map((line) => `${slot.key}: ${line}`));
      mounted?.(host);
      host.fullScreenButton.classList.add(bar.buttonSize);
      bar.fullScreenSlot.append(host.fullScreenButton);
      return {
        el,
        // Nothing to run: the surface keeps itself current, and follows the tab and the project because the renderer drives it directly.
        refresh: () => {},
        contextChanged: () => {},
        // A reveal needs no help: the terminal area refits from its own ResizeObserver once it has a size again.
        setVisible: () => {},
        // Nothing in the config folder is the built-ins' to read.
        recheck: () => {},
        viewChanged: () => mounted?.(host),
        unmount: () => {
          if (hosts.get(name) === host) hosts.delete(name);
          host.fullScreenButton.remove();
          document.getElementById('parked')!.append(el);
        },
      };
    },
  };
  return type;
}
