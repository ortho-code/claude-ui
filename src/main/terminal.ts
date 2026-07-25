import { ipcMain } from 'electron';
import * as pty from 'node-pty';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { SCOPE_ENV } from './status';

const terminals = new Map<number, pty.IPty>();
let nextId = 1;

/** Environment as node-pty wants it: no undefined values. */
function cleanEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // Mark this session as launched by claude-ui so the status hook reports it.
  env[SCOPE_ENV] = '1';
  return env;
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:start', (event, cwd: string, resumeSessionId?: string): number => {
    const id = nextId++;
    const shell = process.env.SHELL ?? '/bin/bash';
    // Session ids are filename-derived; only pass through safe characters.
    const safeId = resumeSessionId && /^[A-Za-z0-9_-]+$/.test(resumeSessionId) ? resumeSessionId : null;
    // Resume through a login shell so PATH resolves claude, then keep the shell
    // open after claude exits.
    const args = safeId ? ['-l', '-c', `claude --resume ${safeId}; exec ${shell} -l`] : ['-l'];
    const proc = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: cwd && existsSync(cwd) ? cwd : os.homedir(),
      env: cleanEnv(),
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
}
