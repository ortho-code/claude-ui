import { ipcMain } from 'electron';
import * as pty from 'node-pty';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { SCOPE_ENV, TAB_ENV, statusSettingsFile } from './status';

const terminals = new Map<number, pty.IPty>();
let nextId = 1;

/** Environment as node-pty wants it: no undefined values. */
function cleanEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Strip Claude Code harness variables. When the app is launched from inside a Claude
    // session these get inherited, and the claude we spawn then thinks it is a nested SDK /
    // child session and never persists its transcript. Keep our own CLAUDE_UI marker.
    if (key !== SCOPE_ENV && (key === 'CLAUDECODE' || key.startsWith('CLAUDE_'))) continue;
    env[key] = value;
  }
  // Mark this session as launched by claude-ui so the status hook reports it.
  env[SCOPE_ENV] = '1';
  // Advertise 24-bit colour so claude emits its full TUI styling (e.g. the select-menu highlight)
  // instead of a degraded fallback; the frontend xterm renders truecolor fine.
  env.COLORTERM = 'truecolor';
  return env;
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:start', (event, cwd: string, resumeSessionId?: string, tabToken?: string, fork?: boolean, name?: string): number => {
    const id = nextId++;
    const shell = process.env.SHELL ?? '/bin/bash';
    // Session ids are filename-derived; only pass through safe characters.
    const safeId = resumeSessionId && /^[A-Za-z0-9_-]+$/.test(resumeSessionId) ? resumeSessionId : null;
    // Resume the given session, or start a fresh one when there's no id. When claude exits, the
    // shell exits too (no trailing `exec bash`), so the pty closes and the renderer can close the
    // tab instead of leaving a bare shell behind. The shell is interactive (-i) as well as login
    // (-l): a non-interactive shell skips ~/.bashrc (the usual `case $- in *i*) ;; *) return;;
    // esac` guard), so any rc-based per-directory setup — mise/asdf/direnv activation, PATH, env
    // vars — never runs, and claude launches without the tools its MCP servers need. An
    // interactive shell in the pty runs that setup for the session's directory, like a real
    // terminal.
    // Load claude-ui's status hooks from its own settings file (merges with the user's ~/.claude
    // hooks) so we never write into the user's settings.json. Guard on existence in case the app is
    // mid-startup and installStatusHooks() hasn't written it yet.
    const base = existsSync(statusSettingsFile) ? `claude --settings '${statusSettingsFile}'` : 'claude';
    // `--name` sets the session's display name (claude writes it as a custom-title, so the sidebar
    // picks it up). Single-quote it, escaping any embedded quotes, since the whole command is a
    // string handed to `bash -c`.
    const nameArg = name ? ` --name '${name.replace(/'/g, "'\\''")}'` : '';
    // `--fork-session` copies the resumed transcript into a new session id (a fork); it needs an id
    // to resume from, so it only applies when we have one.
    const resume = safeId ? ` --resume ${safeId}${fork ? ' --fork-session' : ''}` : '';
    const command = `${base}${resume}${nameArg}`;
    const args = ['-l', '-i', '-c', command];
    const env = cleanEnv();
    if (tabToken) env[TAB_ENV] = tabToken;
    const proc = pty.spawn(shell, args, {
      // xterm.js speaks 256-colour/truecolor; the old 'xterm-color' (8-colour) terminfo made claude
      // pick a degraded palette for its TUI.
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd && existsSync(cwd) ? cwd : os.homedir(),
      env,
    });
    terminals.set(id, proc);

    const sender = event.sender;
    proc.onData((data) => {
      if (!sender.isDestroyed()) sender.send('terminal:data', id, data);
    });
    proc.onExit(({ exitCode }) => {
      terminals.delete(id);
      if (!sender.isDestroyed()) sender.send('terminal:exit', id, exitCode);
    });

    return id;
  });

  ipcMain.on('terminal:input', (_event, id: number, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });

  ipcMain.on('terminal:kill', (_event, id: number) => {
    terminals.get(id)?.kill();
    terminals.delete(id);
  });

  // Graceful close: give claude its normal exit path (Ctrl-C twice) so it flushes the
  // transcript, then kill the leftover shell.
  ipcMain.on('terminal:close', (_event, id: number) => {
    const proc = terminals.get(id);
    if (!proc) return;
    terminals.delete(id);
    proc.write('\x03');
    setTimeout(() => proc.write('\x03'), 400);
    setTimeout(() => proc.kill(), 1800);
  });
}

/** SIGTERM every live session so claude gets a chance to flush before the app quits. */
export function terminateAll(): void {
  for (const proc of terminals.values()) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }
  terminals.clear();
}
