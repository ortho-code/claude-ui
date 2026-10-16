import type { PanelShells } from '../../../shared/panels';
import type { PanelSlot } from '../layout';
import { confirmDanger, promptText } from '../../dialogs';
import { isQuitting } from '../../quitting';
import { folderName } from '../../logic';
import type { MenuItem } from '../../menu';
import { store } from '../../state/app';
import { projName } from '../../state/views';
import { bindTerminal, createTerminal, unbindTerminal, type TerminalView } from '../../terminal';
import './terminal.css';
import { CWD_OPTION, isFixedPath, optionsOf, type OptionDecl } from '../options';
import type { MountedPanel, PanelHost, PanelTab, PanelType, Where } from '../contract';
import { NO_CONTEXT, prepare, resolveContext, runContext } from '../run';

/**
 * The `terminal` panel type: plain shells beside the terminal, each in a pty and an xterm of its own, as tabs in the panel's header (docs/architecture.md § The `terminal` type).
 *
 * A SHELL STAYS PUT.
 * It starts in the folder it is made in — the context directory, or its `cwd` under it, or a fixed `cwd` — and stays there through tab and project switches; a shell has state, and a switch must never kill a command running in it.
 * `+` makes another where you are working now, and Restart here, in a tab's menu, starts a tab's shell again there.
 *
 * BY PROJECT, unless the `scope` option says otherwise: the tabs on show are the selected project's, All shows every project's in a row each, and the others go on running out of sight.
 * ONLY YOU MAKE A SHELL, with `+` or a key on the line a project with none shows: a switch of project, or the panel coming into view, makes no tab, so looking through projects adds none.
 * The tab on show starts its shell when it comes into view if it has none yet, so one brought back from the last launch runs again when its project is shown; that never adds a tab.
 *
 * A shell that EXITS leaves its screen up with a line saying so, and stays so until the next key, which starts a new one in its tab, so getting a shell back never depends on a button being there.
 */

/** What a shell says of its first problem, as the header's word, which carries no full stop. */
const problemSaid = (problems: string[]): string => problems[0]?.replace(/\.$/, '') ?? 'could not start';

/** Which shells a panel shows: the selected project's, or every one in every project. */
const SCOPE_OPTION: OptionDecl = { name: 'scope', kind: 'choice', values: ['project', 'global'] };

/** A shell the panel holds, and the tab it is shown under. */
interface Shell {
  /** The panel's own id for it, which its tab is drawn by. */
  id: string;
  name: string;
  /** The project it belongs to, its repo root, for a panel that shows shells by project; null for one that shows every shell everywhere. */
  project: string | null;
  /** The folder its shell starts in: where it was made or Restart here last started it, or for one brought back, where it was when the app last quit. */
  folder: string;
  box: HTMLElement;
  view: TerminalView | null;
  /** Its live shell's terminal id, or null while there is none. */
  terminalId: number | null;
  starting: boolean;
  /** No shell because the last one ended, or never started: a key starts one. */
  exited: boolean;
  /** Closed while its shell was still starting, which then hands that shell straight back. */
  closed: boolean;
  /** Which of its starts is the latest: a start overtaken by another, a restart asked for while it was on its way, hands its shell straight back. */
  starts: number;
  /** Picked by you before it had a terminal to focus: it takes the keys once it has one. */
  focusWhenStarted: boolean;
  observer: ResizeObserver;
}

class TerminalPanel implements MountedPanel {
  readonly el = document.createElement('div');
  /** The line in a shell's place when there is none: no context to start one in, or no shell made here yet. */
  private readonly placeholder = document.createElement('div');
  /** In the order their tabs are drawn, every project's together. */
  private shells: Shell[] = [];
  /** The tab on show, by what is on show: a project, All, or everywhere (`scopeKey`). */
  private readonly onShow = new Map<string, string>();
  /** Whether the panel is on screen, as the tree last said. */
  private onScreen = false;
  /** No shell because the options did not pass; a recheck that passes starts the tab on show, if there is one. */
  private refused = false;
  private disposed = false;
  private nextId = 1;
  /** Shells being made, between the ask and the check of their folder, while the line still stands where the shell will be. */
  private adding = 0;
  /** Its kept shells have been read: until then it starts none, and keeps nothing, which would be written over them. */
  private loaded = false;
  /** Its kept shells could not be read, so it keeps nothing this run: what it holds would be written over them. */
  private unkept = false;
  private saveQueued = false;
  /** How many looks at the selection it has asked for, so only the latest sets what the panel is (`prepared`). */
  private looks = 0;
  /** Whether it is asking before ending a shell (`mayEnd`). */
  private asking = false;
  /** Its tabs folded to the row on show where they are in rows, as in All; kept with the shells. */
  private folded = false;
  private readonly unwatch: () => void;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
  ) {
    this.el.className = 'panel-body';
    this.placeholder.className = 'pane-placeholder';
    this.placeholder.tabIndex = 0;
    this.placeholder.hidden = true;
    // A key starts a shell where the line says there is none, as a key does in a shell that has exited.
    // One shell for the keys typed while it is being made: the line stands until it is, and typing `ls` there made two.
    this.placeholder.addEventListener('keydown', (event) => {
      if (event.target !== this.placeholder || !this.mayAdd() || event.ctrlKey || event.altKey || event.metaKey || (event.key.length !== 1 && event.key !== 'Enter')) return;
      event.preventDefault();
      if (this.adding === 0) void this.add();
    });
    this.el.append(this.placeholder);
    // A project's name heads its row in All, and its place there is the project order you set.
    this.unwatch = store.watch(['projectNames', 'projectOrder'], () => this.draw());
    // Checked at once rather than on first show, so a panel behind another already wears `alert` on its rail.
    void this.prepared();
    void this.load();
  }

  /**
   * Bring back the shells kept from the last launch, as tabs with no shell yet: the one on show starts when the panel comes into view, the others when they are picked, each in the folder it was in when the app quit, where that could be read, else where it was made or last restarted here.
   * What was on screen in them is not kept, since it would put whatever a shell printed on disk.
   */
  private async load(): Promise<void> {
    let kept: PanelShells | undefined;
    try {
      kept = (await window.claudeUi.getPanelData(this.slot.key)).shells;
    } catch (error) {
      this.unkept = true;
      window.claudeUi.log('warn', 'terminal', `${this.slot.key}: its shells could not be read, so none came back, and none are kept this run: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.disposed) return;
    for (const each of kept?.list ?? []) this.shells.push(this.make(each.project, each.folder, { id: each.id, name: each.name }));
    for (const [where, id] of Object.entries(kept?.shown ?? {})) this.onShow.set(where, id);
    this.folded = kept?.folded === true;
    this.loaded = true;
    this.draw();
    this.ensure();
  }

  /**
   * Keep the shells as they are now, whole, for the next launch: once what changed them has run to its end, so a change of several parts is one write.
   * Not once the app is quitting, when what changes is the quit's doing, and main keeps where each shell was; nor in a run whose kept shells could not be read.
   */
  private save(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    queueMicrotask(() => {
      this.saveQueued = false;
      if (this.disposed || !this.loaded || this.unkept || isQuitting()) return;
      const ids = new Set(this.shells.map((shell) => shell.id));
      const shells: PanelShells = {
        list: this.shells.map(({ id, name, project, folder }) => ({ id, name, project, folder })),
        shown: Object.fromEntries([...this.onShow].filter(([, id]) => ids.has(id))),
        ...(this.folded ? { folded: true } : {}),
      };
      window.claudeUi.setPanelShells(this.slot.key, shells).catch((error: unknown) => {
        window.claudeUi.log('warn', 'terminal', `${this.slot.key}: its shells could not be kept: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  refresh(): void {
    const shell = this.current();
    if (shell) void this.restartHere(shell);
  }

  contextChanged(): void {
    this.draw();
    // Where you are now may let the panel run where it could not before, or the other way round, so it looks again before starting anything.
    void this.prepared().then(({ runnable }) => {
      if (runnable) this.ensure();
    });
  }

  /** Called on every draw of the tree: only a change from hidden to shown is the panel coming into view. */
  setVisible(visible: boolean): void {
    const was = this.onScreen;
    this.onScreen = visible;
    if (!visible || was) return;
    if (this.refused) {
      // Coming back into view while it could not start is a look at it, so it looks again: with no button on a fixed terminal, that is how a folder that has appeared since is picked up.
      this.recheck();
      return;
    }
    this.draw();
    this.ensure();
  }

  recheck(): void {
    // Only a panel that was refused has anything to gain: a running shell is never restarted by a change elsewhere in the folder.
    if (!this.refused) return;
    void this.prepared().then(({ runnable }) => {
      if (runnable) this.ensure();
    });
  }

  unmount(): void {
    this.disposed = true;
    this.unwatch();
    for (const shell of this.shells) this.dispose(shell);
    this.shells = [];
  }

  // ——— what is on show ———

  private scope(): 'project' | 'global' {
    const { scope, cwd } = optionsOf(this.slot.entry);
    if (scope === 'project' || scope === 'global') return scope;
    // A fixed folder does not follow the project, so neither do its shells, unless the entry says they should.
    return typeof cwd === 'string' && isFixedPath(cwd) ? 'global' : 'project';
  }

  /** What is on show, which the tab on show is remembered by: a project by its root, All as '', and everywhere as '*'. */
  private scopeKey(): string {
    return this.scope() === 'global' ? '*' : (this.host.where().project ?? '');
  }

  /** The shells whose tabs are on show, in the order they are drawn: in All, a project's together, in the project order you set. */
  private visible(): Shell[] {
    if (this.scope() === 'global') return this.shells;
    const project = this.host.where().project;
    if (project !== null) return this.shells.filter((shell) => shell.project === project);
    const order = store.get().projectOrder;
    const rank = (root: string | null): number => {
      const at = root === null ? -1 : order.indexOf(root);
      return at < 0 ? order.length : at;
    };
    // A stable sort, so a project's shells keep their own order.
    return [...this.shells].sort((a, b) => rank(a.project) - rank(b.project));
  }

  /** The shell on show: the one last picked where you are, else the first. */
  private current(): Shell | null {
    const visible = this.visible();
    const id = this.onShow.get(this.scopeKey());
    return visible.find((shell) => shell.id === id) ?? visible[0] ?? null;
  }

  /** Whether a shell can be made where you are: a project to file it under where shells go by project, and a folder to start it in. */
  private mayAdd(): boolean {
    const context = resolveContext(this.host.where());
    if (this.scope() === 'project') return context !== null;
    const { cwd } = optionsOf(this.slot.entry);
    return context !== null || (typeof cwd === 'string' && isFixedPath(cwd));
  }

  /** Say what is on show: which shell's box, the line when there is none, the tabs, and the count on the rail. */
  private draw(): void {
    if (this.disposed) return;
    const visible = this.visible();
    const current = this.current();
    for (const shell of this.shells) shell.box.hidden = shell !== current;
    this.placeholder.hidden = current !== null;
    if (!current) this.drawLine();
    this.host.setCount(visible.length > 0 ? visible.length : null);
    // With no tab, the header is the ordinary one, with the panel's title: a `+` alone there looked like something had gone wrong, and the line below offers New terminal.
    if (visible.length === 0) {
      this.host.setTabs(null);
      return;
    }
    const clustered = this.scope() === 'project' && this.host.where().project === null;
    const view = store.get();
    this.host.setTabs({
      tabs: visible.map((shell): PanelTab => ({
        id: shell.id,
        text: shell.name,
        tooltip: shell.exited ? `${shell.folder}\nNo shell: a key in it starts one.` : shell.folder,
        shown: shell === current,
        cold: shell.terminalId === null,
        button: { mark: 'close', tooltip: 'Close terminal' },
        cluster: clustered && shell.project !== null ? { key: shell.project, label: projName(shell.project, view) } : null,
      })),
      addLabel: 'New terminal here',
      addRefused: this.mayAdd() ? null : NO_CONTEXT,
      kebabLabel: 'Terminal options',
      select: (id) => this.withShell(id, (shell) => this.select(shell, true)),
      press: (id) => this.withShell(id, (shell) => void this.askClose(shell)),
      menu: (id) => {
        const shell = this.shells.find((each) => each.id === id);
        return shell ? this.menu(shell) : null;
      },
      rename: (id) => this.withShell(id, (shell) => void this.rename(shell)),
      reorder: (ids) => this.reorder(ids),
      add: () => void this.add(),
      showCluster: (root) => this.host.revealProject(root),
      folded: this.folded,
      fold: (folded) => {
        this.folded = folded;
        this.draw();
        this.save();
      },
    });
  }

  /** The line in a shell's place: nowhere to start one, or no shell here yet, which a key or the button starts. */
  private drawLine(): void {
    if (!this.mayAdd()) {
      this.placeholder.replaceChildren(NO_CONTEXT);
      return;
    }
    const project = this.scope() === 'project' ? this.host.where().project : null;
    const sentence = document.createElement('div');
    sentence.textContent = project !== null ? `No terminal in ${projName(project, store.get())}.` : 'No terminal yet.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'New terminal';
    button.addEventListener('click', () => void this.add());
    const hint = document.createElement('div');
    hint.textContent = 'or press any key here';
    this.placeholder.replaceChildren(sentence, button, hint);
  }

  /**
   * The tab on show starts its shell if it has none yet and has not exited, once the panel is on screen; where there is no tab, nothing is made, since only you make shells.
   * Not focused: a shell started by itself must not take the keys from wherever you are typing.
   */
  private ensure(): void {
    if (!this.loaded || !this.onScreen || this.refused || this.disposed) return;
    const current = this.current();
    if (current?.terminalId === null && !current.starting && !current.exited) void this.start(current, current.folder);
  }

  // ——— what a tab does ———

  private withShell(id: string, act: (shell: Shell) => void): void {
    const shell = this.shells.find((each) => each.id === id);
    if (shell) act(shell);
  }

  /** Put a shell on show, started if it has nothing running and has not exited, and with the keys when `focus` says you picked it. */
  private select(shell: Shell, focus: boolean): void {
    this.onShow.set(this.scopeKey(), shell.id);
    if (shell.project !== null) this.onShow.set(shell.project, shell.id);
    this.draw();
    this.save();
    if (shell.terminalId === null && !shell.starting && !shell.exited) void this.start(shell, shell.folder);
    if (!focus) return;
    if (shell.view) shell.view.term.focus();
    else shell.focusWhenStarted = true;
  }

  /**
   * A new shell where you are working now, after the last of its project's, on show there, and with the keys if it is still on show when its shell starts.
   * Where it belongs is read as it is asked for, so a switch while its folder is being checked files it where it was asked.
   */
  private async add(): Promise<void> {
    const key = this.scopeKey();
    const project = this.scope() === 'project' ? (resolveContext(this.host.where())?.projectRoot ?? null) : null;
    if (this.scope() === 'project' && project === null) {
      this.draw();
      return;
    }
    this.adding += 1;
    let prepared: Awaited<ReturnType<typeof this.prepared>>;
    try {
      prepared = await this.prepared();
    } finally {
      this.adding -= 1;
    }
    const { runnable, run } = prepared;
    if (!runnable || !run || this.disposed) {
      this.draw();
      return;
    }
    const shell = this.make(project, run.cwd);
    let last = -1;
    this.shells.forEach((each, at) => {
      if (each.project === project) last = at;
    });
    if (last < 0) this.shells.push(shell);
    else this.shells.splice(last + 1, 0, shell);
    this.onShow.set(key, shell.id);
    if (project !== null) this.onShow.set(project, shell.id);
    shell.focusWhenStarted = true;
    this.draw();
    this.save();
    void this.start(shell, shell.folder);
  }

  /** A shell's tab, with no shell yet: a new one, or one kept from the last launch, which brings its own id and name. */
  private make(project: string | null, folder: string, kept?: { id: string; name: string }): Shell {
    const box = document.createElement('div');
    box.className = 'panel-terminal';
    box.hidden = true;
    this.el.append(box);
    const shell: Shell = {
      id: kept?.id ?? `${Date.now().toString(36)}-${this.nextId++}`,
      name: kept?.name ?? this.freeName(project, folderName(folder)),
      project,
      folder,
      box,
      view: null,
      terminalId: null,
      starting: false,
      exited: false,
      closed: false,
      starts: 0,
      focusWhenStarted: false,
      // Fit whenever the box changes size, its first layout included: a shell is made before its box is on screen, so it measures nothing yet, and a fit now would leave xterm at its 80×24 default — the hidden-pane trap.
      // The same observer covers every later reveal — its tab picked, a group unfolding from its rail, a divider reopening a squeezed node — since each gives the box a size again.
      observer: new ResizeObserver(() => this.fit(shell)),
    };
    shell.observer.observe(box);
    return shell;
  }

  /** A shell's name: its folder's, numbered from 2 when another of its project's has it. */
  private freeName(project: string | null, base: string, except?: Shell): string {
    const taken = new Set(this.shells.filter((shell) => shell.project === project && shell !== except).map((shell) => shell.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  private close(shell: Shell): void {
    const visible = this.visible();
    const at = visible.indexOf(shell);
    const wasCurrent = this.current() === shell;
    this.dispose(shell);
    this.shells = this.shells.filter((each) => each !== shell);
    const next = wasCurrent ? (visible[at + 1] ?? visible[at - 1] ?? null) : null;
    if (next) this.select(next, true);
    else this.draw();
    this.save();
  }

  private menu(shell: Shell): MenuItem[] {
    return [
      { label: 'Rename…', onSelect: () => void this.rename(shell) },
      { label: 'Restart here', onSelect: () => void this.restartHere(shell) },
      { separator: true, label: '' },
      { label: 'Close terminal', onSelect: () => void this.askClose(shell) },
    ];
  }

  /**
   * Whether ending a shell's running shell is all right: at once when nothing runs in its foreground but the shell, else when you say so, asked naming what runs, which main reads off its terminal at this moment.
   * Read at the press rather than kept on the tab, since a short command would change a mark there as it came and went.
   */
  private async mayEnd(shell: Shell, question: string, consequence: string, action: string): Promise<boolean> {
    if (shell.terminalId === null) return true;
    // One question at a time: a second press while the first is being asked, or answered, ends nothing, rather than taking the first's answer as its own.
    if (this.asking) return false;
    this.asking = true;
    try {
      const running = await window.claudeUi.terminalForeground(shell.terminalId);
      if (running === null) return true;
      return await confirmDanger(question, `“${running}” is still running in “${shell.name}”. ${consequence}`, action);
    } finally {
      this.asking = false;
    }
  }

  /** Close a shell's tab: the button, a middle-click and its menu's Close alike, asking first while a command runs in it. */
  private async askClose(shell: Shell): Promise<void> {
    if (!(await this.mayEnd(shell, 'Close this terminal?', 'Closing the terminal ends it.', 'Close terminal'))) return;
    if (!shell.closed) this.close(shell);
  }

  private async rename(shell: Shell): Promise<void> {
    const name = await promptText('Rename terminal', shell.folder, shell.name);
    const trimmed = name?.trim();
    if (!trimmed || shell.closed) return;
    shell.name = trimmed;
    this.draw();
    this.save();
  }

  /** A drag left these tabs in this order: they take the places they had among the rest, in the new order. */
  private reorder(ids: string[]): void {
    const moving = new Set(ids);
    const byId = new Map(this.shells.map((shell) => [shell.id, shell]));
    const places = this.shells.flatMap((shell, at) => (moving.has(shell.id) ? [at] : []));
    const next = [...this.shells];
    places.forEach((place, k) => {
      const shell = byId.get(ids[k]!);
      if (shell) next[place] = shell;
    });
    this.shells = next;
    this.draw();
    this.save();
  }

  /**
   * Where a shell of a project starts as you are working now, when that is not the selection: its project's root, as in All with another project's tab on show, or with none.
   * Undefined where the selection is that place: the shell is filed under no project, or the selection is in its project.
   */
  private ownWhere(shell: Shell): Where | undefined {
    if (shell.project === null) return undefined;
    const where = this.host.where();
    const inIt = where.tab ? where.tab.repoRoot === shell.project : where.project === shell.project;
    return inIt ? undefined : { tab: null, project: shell.project };
  }

  /** A new shell in the tab, in the folder you are working in now within its own project (`ownWhere`), asking first while a command runs in the one it replaces. */
  private async restartHere(shell: Shell): Promise<void> {
    const own = this.ownWhere(shell);
    const { runnable, run, problems } = await this.prepared(own);
    // The panel cannot run where you are, which it says in its place: nothing restarts behind that.
    if (shell.closed || this.disposed || this.refused) return;
    // Refused in its own project: checked before anything ends, so the shell is left running, and the header says why.
    if (!runnable && own !== undefined) this.sayFailed(problemSaid(problems));
    if (!runnable || !run) return;
    if (!(await this.mayEnd(shell, 'Restart this terminal?', 'Restarting the terminal ends it.', 'Restart'))) return;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a close or an unmount can run while the question is up, which TypeScript's narrowing does not see
    if (shell.closed || this.disposed) return;
    this.stop(shell);
    shell.folder = run.cwd;
    shell.focusWhenStarted = true;
    this.onShow.set(this.scopeKey(), shell.id);
    this.save();
    await this.start(shell, run.cwd);
  }

  // ——— a shell's life ———

  /**
   * Check the options against where a shell would start, and hand back that folder.
   * Against the selection, the problems are the panel's: the tree draws them in its place, and it runs nothing until they pass.
   * Against `where`, a shell's own project (`ownWhere`), they are that shell's alone, handed back for it to say, since the panel's would hide every shell for one project's lack.
   */
  private async prepared(where?: Where): Promise<{ runnable: boolean; run: { cwd: string } | null; problems: string[] }> {
    const look = where === undefined ? ++this.looks : this.looks;
    const prepared = await prepare(optionsOf(this.slot.entry), terminalType, where ?? this.host.where());
    if (this.disposed) return { runnable: false, run: null, problems: [] };
    const runnable = prepared.problems.length === 0;
    // Only the latest look at the selection says what the panel is: main can answer an earlier one last, at a place you have since left.
    if (where === undefined && look === this.looks) {
      const was = this.refused;
      this.refused = !runnable;
      this.host.setProblems(prepared.problems);
      if (was !== this.refused) this.draw();
    }
    return { runnable, run: prepared.run, problems: prepared.problems };
  }

  /**
   * Start a shell in `folder` for `shell`'s tab, on its own screen, wiped when it had one before.
   * Only its latest start counts: one overtaken on its way, by a restart or a close, hands its shell straight back and leaves the tab to the start that overtook it.
   */
  private async start(shell: Shell, folder: string): Promise<void> {
    const start = ++shell.starts;
    const latest = (): boolean => shell.starts === start && !shell.closed && !this.disposed;
    shell.exited = false;
    shell.starting = true;
    // Checked against its own project, as Restart here checked it, so the two look at the same place unless the selection changes between them.
    const own = this.ownWhere(shell);
    const { runnable, problems } = await this.prepared(own);
    if (!latest()) return;
    // The panel cannot run where you are: it says why in its place, over every shell, and starts none behind that, another project's shell included.
    if (this.refused) {
      shell.starting = false;
      return;
    }
    if (!shell.view) {
      const view = createTerminal(shell.box);
      shell.view = view;
      view.term.onData((data) => {
        if (shell.terminalId !== null) window.claudeUi.sendTerminalInput(shell.terminalId, data);
        // The key is the ask for a new shell, so it is not sent on to it.
        else if (shell.exited && !shell.starting) void this.start(shell, shell.folder);
      });
    } else {
      // A restart: the old shell's screen goes, so the new prompt is not painted over its tail.
      shell.view.term.reset();
    }
    this.draw();
    const { term } = shell.view;
    if (!runnable) {
      // Refused in its own project: this shell alone says why, as a start main refuses does.
      this.failed(shell, problemSaid(problems));
      shell.starting = false;
      this.draw();
      return;
    }
    try {
      // Filed under a project, its variables name that project whatever is selected, as in All with another project's tab on show; filed under none, the selection.
      const id = await window.claudeUi.startShell(folder, runContext(resolveContext(this.host.where()), folder, shell.project), { entryId: this.slot.key, shellId: shell.id });
      // Closed or overtaken while it was starting: hand the shell straight back rather than leave one running with nothing showing it.
      if (!latest()) {
        window.claudeUi.killTerminal(id);
        return;
      }
      shell.terminalId = id;
      bindTerminal(id, {
        data: (data) => term.write(data),
        exit: (exitCode) => {
          if (shell.terminalId !== id) return;
          shell.terminalId = null;
          shell.exited = true;
          // On the shell's own screen, dimmed, where the eye already is; its tab goes unfilled, as a tab with nothing behind it does.
          term.write(`\r\n\x1b[2m[exited ${exitCode} — press any key for a new shell]\x1b[0m`);
          this.draw();
        },
      });
      this.host.setEnd('');
      this.host.setStatus(null);
      this.fit(shell);
      // Only while it is on show: keys typed into a shell out of sight would go where nobody can see them.
      if (shell.focusWhenStarted && this.current() === shell) term.focus();
      shell.focusWhenStarted = false;
    } catch (error) {
      if (!latest()) return;
      const missing = (error instanceof Error ? error.message : '').includes('MISSING_CWD:');
      this.failed(shell, missing ? `${folder} is not there` : 'could not start');
    } finally {
      // An overtaken start leaves the tab to the start that overtook it.
      if (latest()) {
        shell.starting = false;
        this.draw();
      }
    }
  }

  /** A shell that could not start says why on its own screen, dimmed, with a key to try again, and in the header (`sayFailed`). */
  private failed(shell: Shell, said: string): void {
    shell.exited = true;
    shell.view?.term.write(`\x1b[2m[${said} — press any key to try again]\x1b[0m`);
    this.sayFailed(said);
  }

  /** Why a shell could not start or restart, in the header and with the rail's red dot: a shell that exits is somebody typing `exit`, and one that never started is the failure worth a dot. */
  private sayFailed(said: string): void {
    this.host.setEnd(said);
    this.host.setStatus('fail');
  }

  /** End a shell, if it has one, and stop listening to it: its tail belongs to nobody once a restart or a close has been asked for. */
  private stop(shell: Shell): void {
    if (shell.terminalId === null) return;
    unbindTerminal(shell.terminalId);
    window.claudeUi.killTerminal(shell.terminalId);
    shell.terminalId = null;
  }

  private dispose(shell: Shell): void {
    shell.closed = true;
    this.stop(shell);
    shell.observer.disconnect();
    shell.view?.term.dispose();
    shell.view = null;
    shell.box.remove();
  }

  private fit(shell: Shell): void {
    if (!shell.view || shell.box.hidden || shell.box.clientWidth === 0 || shell.box.clientHeight === 0) return;
    shell.view.fitAddon.fit();
    if (shell.terminalId !== null) window.claudeUi.resizeTerminal(shell.terminalId, shell.view.term.cols, shell.view.term.rows);
  }
}

export const terminalType: PanelType = {
  name: 'terminal',
  options: [CWD_OPTION, SCOPE_OPTION],
  exactlyOne: [],
  icon: 'terminal',
  defaultTitle: () => 'Terminal',
  // `+` after its tabs makes a shell, and Restart here is in a tab's menu, so the header has no button of its own.
  actionLabel: () => null,
  mount: (slot, host) => new TerminalPanel(slot, host),
};
