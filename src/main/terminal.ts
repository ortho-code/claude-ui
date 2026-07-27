import { ipcMain } from 'electron';
import * as pty from 'node-pty';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { SCOPE_ENV, TAB_ENV } from './status';

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
  return env;
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:start', (event, cwd: string, resumeSessionId?: string, tabToken?: string): number => {
    const id = nextId++;
    const shell = process.env.SHELL ?? '/bin/bash';
    // Session ids are filename-derived; only pass through safe characters.
    const safeId = resumeSessionId && /^[A-Za-z0-9_-]+$/.test(resumeSessionId) ? resumeSessionId : null;
    // Resume the given session, or start a fresh one when there's no id. Keep the shell open
    // after claude exits. The shell is interactive (-i) as well as login (-l): a non-interactive
    // shell skips ~/.bashrc (the usual `case $- in *i*) ;; *) return;; esac` guard), so any
    // rc-based per-directory setup — mise/asdf/direnv activation, PATH, env vars — never runs,
    // and claude launches without the tools its MCP servers need. An interactive shell in the
    // pty runs that setup for the session's directory, matching a real terminal.
    const command = safeId ? `claude --resume ${safeId}` : 'claude';
    const args = ['-l', '-i', '-c', `${command}; exec ${shell} -l`];
    const env = cleanEnv();
    if (tabToken) env[TAB_ENV] = tabToken;
    const proc = pty.spawn(shell, args, {
      name: 'xterm-color',
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
