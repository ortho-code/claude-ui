import { ipcMain, BrowserWindow } from 'electron';
import { promises as fs, watch, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const configDir = path.join(os.homedir(), '.config', 'claude-ui');
const statusDir = path.join(configDir, 'status');
const hookScriptPath = path.join(configDir, 'status-hook.sh');
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
/** claude-ui-owned settings file, passed to claude via `--settings` (terminal.ts); holds our hooks
 * only. Keeps the status hooks out of the user's ~/.claude/settings.json (which may be tracked). */
export const statusSettingsFile = path.join(configDir, 'claude-settings.json');

/** Env var claude-ui sets on its terminals; the hook only reports when it is present. */
export const SCOPE_ENV = 'CLAUDE_UI';

/** Per-terminal token so the app can match a reported session id back to the tab that spawned it. */
export const TAB_ENV = 'CLAUDE_UI_TAB';

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
tab="\${CLAUDE_UI_TAB:-}"
if [ -n "$sid" ]; then
  printf '{"status":"%s","ts":%s,"tab":"%s"}\\n' "$status" "$(date +%s)" "$tab" > "$dir/$sid.json"
fi
exit 0
`;

/**
 * Write the hook script and a claude-ui-owned settings file holding the status hooks. claude gets
 * that file via `--settings` (terminal.ts), whose hooks MERGE with the user's ~/.claude hooks
 * (verified), so the status hooks work without claude-ui writing into the user's settings.json.
 * Also strips any status hooks an earlier version injected there.
 */
export async function installStatusHooks(): Promise<void> {
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(hookScriptPath, HOOK_SCRIPT, { mode: 0o755 });

  const hooks: Record<string, unknown[]> = {};
  for (const [event, status] of HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command: `${hookScriptPath} ${status}` }] }];
  }
  await fs.writeFile(statusSettingsFile, `${JSON.stringify({ hooks }, null, 2)}\n`);

  await removeInjectedHooks();
}

/**
 * One-time cleanup: earlier versions registered the status hooks directly in the user's
 * ~/.claude/settings.json. Strip only those entries (matched by our hook-script path), leaving
 * every other hook untouched. Idempotent — once removed, later launches find nothing and never
 * rewrite the file, so it stops polluting the user's (possibly version-controlled) settings.
 */
async function removeInjectedHooks(): Promise<void> {
  let settings: { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch {
    return; // Missing (nothing we polluted) or malformed (must not touch it).
  }
  if (!settings.hooks) return;

  let changed = false;
  for (const [event] of HOOK_EVENTS) {
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(
      (entry) => !entry.hooks?.some((h) => typeof h.command === 'string' && h.command.startsWith(hookScriptPath)),
    );
    if (kept.length === entries.length) continue;
    changed = true;
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  // Keep the file's trailing newline (JSON.stringify omits it) so cleanup leaves no spurious diff.
  if (changed) await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Watch the status directory and push per-session status updates to the renderer. */
export function registerStatusIpc(getWindow: () => BrowserWindow | null): void {
  mkdirSync(statusDir, { recursive: true });

  ipcMain.handle('status:getAll', () => readAllStatuses());
  ipcMain.on('status:clear', (_event, id: string) => {
    void fs.rm(path.join(statusDir, `${id}.json`)).catch(() => {});
  });

  watch(statusDir, (_event, filename) => {
    if (!filename || !filename.endsWith('.json')) return;
    const id = filename.replace(/\.json$/, '');
    void readStatus(id).then((entry) => {
      if (entry === null) return;
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('session:status', id, entry.status, entry.tab);
    });
  });
}

interface StatusEntry {
  status: string;
  tab: string;
}

async function readStatus(id: string): Promise<StatusEntry | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, `${id}.json`), 'utf8')) as {
      status?: unknown;
      tab?: unknown;
    };
    if (typeof parsed.status !== 'string') return null;
    return { status: parsed.status, tab: typeof parsed.tab === 'string' ? parsed.tab : '' };
  } catch {
    return null;
  }
}

/** Remove the status files for the given session ids (used when a conversation is deleted). */
export async function clearStatuses(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => fs.rm(path.join(statusDir, `${id}.json`)).catch(() => {})));
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
    const entry = await readStatus(id);
    if (entry) result[id] = entry.status;
  }
  return result;
}
