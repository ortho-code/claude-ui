import { ipcMain, BrowserWindow } from 'electron';
import { promises as fs, watch, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { statusDir, hookScriptPath, statusSettingsFile, shellQuote } from './paths';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

export { statusSettingsFile };

/** Env var claude-ui sets on its terminals; the hook only reports when it is present. */
export const SCOPE_ENV = 'CLAUDE_UI';

/**
 * Per-terminal token, echoed back by the hook so the app can tell WHICH TAB a reported session belongs to.
 *
 * `--session-id` gives a session its identity at birth, and that is the whole of it for a session that runs and ends.
 * This exists for the one thing that flag cannot cover: an id changing MID-LIFE. `/clear` ends the session and starts a fresh one, with an id Claude Code chooses, in the same terminal — without this the tab would go on pointing at the session that just ended.
 */
export const TAB_ENV = 'CLAUDE_UI_TAB';

/**
 * Which Claude Code hook event maps to which status.
 *
 * The question to ask of a new one is what the event MEANS, not what it is called: `SessionEnd` sounds like an ending and `SessionStart` like a beginning, and neither is reliably either.
 */
const HOOK_EVENTS: [string, string][] = [
  ['UserPromptSubmit', 'busy'],
  ['Stop', 'idle'],
  ['Notification', 'waiting'],
  // Also busy, and the reason is the gap it closes.
  // A permission prompt arrives as `Notification`, so the dot goes waiting; approving it is not a `UserPromptSubmit`, so before this NOTHING fired between the approval and the end of the turn, and the dot sat on waiting while the session worked.
  // Measured on a live session: 34 seconds of work showing "needs you".
  // A tool having RUN is the signal that work resumed, which is exactly what was missing.
  // It fires once per tool call, so it is a busier stream than the rest of this table — cheap (one small file write, already debounced by the watcher) and it only ever re-asserts a state the session is already in.
  ['PostToolUse', 'busy'],
  // Ends reset the dot to empty: 'closed' has no color rule, so it renders hollow.
  //
  // EVERY SessionEnd IS AN END FOR THE SESSION IT NAMES, including the `clear` and `resume` reasons that leave the PROCESS running — measured: `/clear` writes a final line to the old transcript and opens a new file under a new id, so the id this event carries is genuinely finished.
  // That distinction is the whole point: this app tracks SESSIONS, not processes. Declining to write `closed` here was tried on 2026-09-22 and reverted the same day; it left a dead session showing a live dot for good.
  // What the process does next is the business of `SessionStart` below, which reports the id that succeeded this one.
  ['SessionEnd', 'closed'],
  // Not a state either: it reports WHICH MODEL the session is on from here.
  // The app cannot get this anywhere else while a session sits idle — a transcript records only which model ANSWERED, so `/model` is invisible in it until the next reply, and the row went on naming the old model in the meantime.
  // MEASURED: the payload carries `from_model`, `to_model`, `requested_model` and `source`; `to_model` is the one that matters and is a full model id.
  ['PostModelSwitch', 'model'],
  // Compaction is claude WORKING — it is thinking about the transcript — so the dot belongs on busy until it finishes, and the finish is a `SessionStart` carrying `source=compact` (see the script).
  // `PostCompact` would be the obvious end signal, but a probe on 2026-08-29 never observed it firing and could not prove it ever does; `SessionStart` was observed.
  ['PreCompact', 'busy'],
  // Two jobs, and only one of them is a status.
  // IDENTITY, always: the payload's session id is what this terminal is running NOW, which is how a tab follows a `/clear` onto the session that replaced it.
  // A STATUS, only for `source=compact`, where it means the compaction above has ended; the script turns that one into `idle` and leaves every other source as the identity-only marker `start`.
  // It must never overwrite a real status, because these files seed the dots at launch and this event also fires mid-session — the script guards that too.
  ['SessionStart', 'start'],
];

/**
 * A hook script Claude runs on each event.
 * It reports only for sessions launched by claude-ui (CLAUDE_UI set), reads what it needs from the JSON on stdin, and writes a status file the app watches.
 * Dependency-free and always exits 0. A hook has about a second before Claude Code moves on, so nothing here may wait on anything.
 */
const HOOK_SCRIPT = `#!/usr/bin/env bash
# Written by claude-ui. Reports Claude Code session status to the app, only for sessions launched by claude-ui (CLAUDE_UI is set on its terminals).
[ -n "\${CLAUDE_UI:-}" ] || exit 0
status="\${1:-}"
dir=${shellQuote(statusDir)}
mkdir -p "$dir"
input="$(cat)"
# One reader for every field this script pulls out of the event, so a second one cannot drift from the first.
field() {
  printf '%s' "$input" | grep -oE "\\"$1\\"[[:space:]]*:[[:space:]]*\\"[^\\"]+\\"" | head -1 | sed -E 's/.*"([^"]+)"$/\\1/'
}
sid="$(field session_id)"
[ -n "$sid" ] || exit 0
# A model switch goes to a file of its own, so it can never overwrite a status: the two answer different questions about the same session.
if [ "$status" = model ]; then
  to="$(field to_model)"
  [ -n "$to" ] && printf '%s' "$to" > "$dir/$sid.model"
  exit 0
fi
# The end of a compaction, which is the only SessionStart that means a state rather than an identity.
if [ "$status" = start ] && [ "$(field source)" = compact ]; then
  status=idle
fi
# Every other SessionStart carries identity only, so it must not overwrite a status: these files seed the dots at launch, and the event fires on clear and compact MID-session, where a session already has a status worth keeping.
# A brand-new session has no file yet, which is the case this still writes for.
if [ "$status" = start ] && [ -e "$dir/$sid.json" ]; then
  exit 0
fi
printf '{"status":"%s","ts":%s,"tab":"%s"}\\n' "$status" "$(date +%s)" "\${CLAUDE_UI_TAB:-}" > "$dir/$sid.json"
exit 0
`;

/**
 * Write the hook script and a claude-ui-owned settings file holding the status hooks.
 * claude gets that file via `--settings` (terminal.ts), whose hooks MERGE with the user's ~/.claude hooks (verified), so the status hooks work without claude-ui writing into the user's settings.json.
 * Also strips any status hooks an earlier version injected there.
 */
export async function installStatusHooks(): Promise<void> {
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(hookScriptPath, HOOK_SCRIPT, { mode: 0o755 });

  const hooks: Record<string, unknown[]> = {};
  for (const [event, status] of HOOK_EVENTS) {
    // Quote the script path: on macOS it sits under "Application Support", and an unquoted space would make claude run "…/Application" with "Support/claude-ui/status-hook.sh" as an argument.
    hooks[event] = [{ hooks: [{ type: 'command', command: `${shellQuote(hookScriptPath)} ${status}` }] }];
  }
  await fs.writeFile(statusSettingsFile, `${JSON.stringify({ hooks }, null, 2)}\n`);

  await removeInjectedHooks();
}

/**
 * One-time cleanup: earlier versions registered the status hooks directly in the user's ~/.claude/settings.json.
 * Strip only those entries (matched by our hook-script path), leaving every other hook untouched.
 * Idempotent — once removed, later launches find nothing and never rewrite the file, so it stops polluting the user's (possibly version-controlled) settings.
 *
 * Every event in the file is scanned rather than the ones this version registers: an entry left behind by a version that hooked an event this one has since dropped (`SessionStart`, retired once the app started minting session ids) would otherwise never be found again.
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
  for (const event of Object.keys(settings.hooks)) {
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(
      // `includes`, not `startsWith`: the command is quoted now, and the entries being cleaned up here were written by versions that did not quote it.
      (entry) => !entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(hookScriptPath)),
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
    if (!filename) return;
    // A model switch, which is a fact about the session rather than a state it is in — hence its own file and its own channel.
    // Deliberately NOT read at launch: by then the transcript's own last answer is the better source, and a file left over from a previous run could only be staler than that.
    if (filename.endsWith('.model')) {
      const id = filename.slice(0, -'.model'.length);
      void fs
        .readFile(path.join(statusDir, filename), 'utf8')
        .then((model) => {
          const win = getWindow();
          if (model.trim() && win && !win.isDestroyed()) win.webContents.send('session:model', id, model.trim());
        })
        .catch(() => {});
      return;
    }
    if (!filename.endsWith('.json')) return;
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
  /** The terminal that reported it (TAB_ENV), or '' for a session claude-ui is not running. */
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

/** Remove everything this directory holds for the given session ids (used when a conversation is deleted). */
export async function clearStatuses(ids: string[]): Promise<void> {
  const files = ids.flatMap((id) => [`${id}.json`, `${id}.model`]);
  await Promise.all(files.map((file) => fs.rm(path.join(statusDir, file)).catch(() => {})));
}

/** Every session's status as the renderer receives it at launch. Exported for the tests that pin what does and does not survive into it. */
export async function readAllStatuses(): Promise<Record<string, string>> {
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
    // 'start' is identity, and identity is answered by the tabs being restored around it — seeding it here would hand the renderer a status no dot has wording for.
    if (entry && entry.status !== 'start') result[id] = entry.status;
  }
  return result;
}
