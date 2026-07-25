import { ipcMain, BrowserWindow } from 'electron';
import { promises as fs, watch, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const configDir = path.join(os.homedir(), '.config', 'claude-ui');
const statusDir = path.join(configDir, 'status');
const hookScriptPath = path.join(configDir, 'status-hook.sh');
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

/** Env var claude-ui sets on its terminals; the hook only reports when it is present. */
export const SCOPE_ENV = 'CLAUDE_UI';

/** Which Claude Code hook event maps to which status. */
const HOOK_EVENTS: [string, string][] = [
  ['UserPromptSubmit', 'busy'],
  ['Stop', 'idle'],
  ['Notification', 'waiting'],
  // Ends reset the dot to empty: 'closed' has no color rule, so it renders hollow.
  ['SessionEnd', 'closed'],
];

/**
 * A hook script Claude runs on each event. It reports only for sessions launched
 * by claude-ui (CLAUDE_UI set), extracts the session id from the JSON on stdin, and
 * writes a status file the app watches. Dependency-free and always exits 0.
 */
const HOOK_SCRIPT = `#!/usr/bin/env bash
# Written by claude-ui. Reports Claude Code session status to the app,
# only for sessions launched by claude-ui (CLAUDE_UI is set on its terminals).
[ -n "\${CLAUDE_UI:-}" ] || exit 0
status="\${1:-}"
dir="$HOME/.config/claude-ui/status"
mkdir -p "$dir"
input="$(cat)"
sid="$(printf '%s' "$input" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\\1/')"
if [ -n "$sid" ]; then
  printf '{"status":"%s","ts":%s}\\n' "$status" "$(date +%s)" > "$dir/$sid.json"
fi
exit 0
`;

/** Write the hook script and register it in ~/.claude/settings.json, merging safely. */
export async function installStatusHooks(): Promise<void> {
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(hookScriptPath, HOOK_SCRIPT, { mode: 0o755 });

  let settings: { hooks?: Record<string, unknown[]> } = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch (error) {
    // A missing file is fine; a malformed one we must not overwrite.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('claude-ui: ~/.claude/settings.json unreadable, skipping hook install', error);
      return;
    }
  }

  settings.hooks ??= {};
  let changed = false;
  for (const [event, status] of HOOK_EVENTS) {
    const entries = (settings.hooks[event] ??= []) as { hooks?: { command?: string }[] }[];
    const present = entries.some((entry) =>
      entry.hooks?.some((hook) => typeof hook.command === 'string' && hook.command.startsWith(hookScriptPath)),
    );
    if (!present) {
      entries.push({ hooks: [{ type: 'command', command: `${hookScriptPath} ${status}` }] } as never);
      changed = true;
    }
  }

  if (changed) {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }
}

/** Watch the status directory and push per-session status updates to the renderer. */
export function registerStatusIpc(getWindow: () => BrowserWindow | null): void {
  mkdirSync(statusDir, { recursive: true });

  ipcMain.handle('status:getAll', () => readAllStatuses());

  watch(statusDir, (_event, filename) => {
    if (!filename || !filename.endsWith('.json')) return;
    const id = filename.replace(/\.json$/, '');
    void readStatus(id).then((status) => {
      if (status === null) return;
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('session:status', id, status);
    });
  });
}

async function readStatus(id: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, `${id}.json`), 'utf8')) as { status?: unknown };
    return typeof parsed.status === 'string' ? parsed.status : null;
  } catch {
    return null;
  }
}

async function readAllStatuses(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let files: string[];
  try {
    files = await fs.readdir(statusDir);
  } catch {
    return result;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    const status = await readStatus(id);
    if (status) result[id] = status;
  }
  return result;
}
