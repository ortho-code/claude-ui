import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs, watch, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { statusDir, hookScriptPath, statusSettingsFile, shellQuote } from './paths';
import { errorText, fsFailure, log } from './log';
import { writeFileAtomic } from './atomic';
import { StringDecoder } from 'node:string_decoder';
import { scheduledTasksOf } from '../shared/scheduled';
import type { ScheduledTask } from '../shared/types';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

export { statusSettingsFile };

/** Env var claude-ui sets on its terminals; the hook only reports when it is present. */
export const SCOPE_ENV = 'CLAUDE_UI';

/**
 * Per-terminal token, echoed back by the hook so the app can tell WHICH TAB a reported session belongs to.
 *
 * `--session-id` gives a session its identity at birth, and that is the whole of it for a session that runs and ends.
 * This exists for the one thing that flag cannot cover: an id changing MID-LIFE.
 * `/clear` ends the session and starts a fresh one, with an id Claude Code chooses, in the same terminal — without this the tab would go on pointing at the session that just ended; claude's own `/resume` does the same into a session that already exists, under that session's id.
 */
export const TAB_ENV = 'CLAUDE_UI_TAB';

/**
 * Which Claude Code hook event maps to which status.
 *
 * The question to ask of a new one is what the event MEANS, not what it is called: `SessionEnd` sounds like an ending and `SessionStart` like a beginning, and neither is reliably either.
 */
const HOOK_EVENTS: [string, string][] = [
  ['UserPromptSubmit', 'busy'],
  // Idle, or `background` while work the turn started still runs: its payload lists that work (`background_tasks`, measured on claude 2.1.289), and the script reads it.
  // For a shell, a monitor and a subagent (measured), the work's end starts a turn of its own, so the next `Stop` brings the list up to date without anything else to hook.
  ['Stop', 'idle'],
  ['Notification', 'waiting'],
  // Also waiting, and the reason is how soon.
  // Claude sends a permission prompt's `Notification` about six seconds after the prompt appears (by its source, six seconds after the later of that and the last key pressed at it), and none at all once it is answered sooner; `PermissionRequest` fires as the prompt appears (measured on claude 2.1.289, four prompts: the notice 6.0 s after it for the two left open, and none for the two answered about a second after it).
  // It fired for no call that was let through without a prompt (measured: seventeen in default mode, three in auto mode), so it does not flash the dot to waiting for a call nobody is asked about, unless another `PermissionRequest` hook answers the request itself (by claude's source), when the dot says waiting until the tool has run, or, if that hook turns it down, until the next hook.
  ['PermissionRequest', 'waiting'],
  // Also busy, and the reason is the gap it closes.
  // A permission prompt arrives as `Notification`, so the dot goes waiting; approving it is not a `UserPromptSubmit`, so before this NOTHING fired between the approval and the end of the turn, and the dot sat on waiting while the session worked.
  // Measured on a live session: 34 seconds of work showing "needs you".
  // A tool having RUN is the signal that work resumed, which is exactly what was missing.
  // It fires once per tool call, so it is a busier stream than the rest of this table — cheap (one small file write, already debounced by the watcher) and it only ever re-asserts a state the session is already in.
  ['PostToolUse', 'busy'],
  // Ends reset the dot to empty: 'closed' has no color rule, so it renders hollow.
  //
  // EVERY SessionEnd IS AN END FOR THE SESSION IT NAMES, including the `clear` and `resume` reasons that leave the PROCESS running — measured: `/clear` writes a final line to the old transcript and opens a new file under a new id, so the id this event carries is genuinely finished.
  // That distinction is the whole point: this app tracks SESSIONS, not processes.
  // Declining to write `closed` here was tried on 2026-09-22 and reverted the same day; it left a dead session showing a live dot for good.
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
  // IDENTITY, always: the payload's session id is what this terminal is running NOW, which is how a tab follows a `/clear` or claude's own `/resume` onto the session that replaced it; the script writes it with its source to a file of its own (`<id>.start`), since the status file below keeps a status it already has.
  // A STATUS, only for `source=compact`, where it means the compaction above has ended; the script turns that one into `idle` and leaves every other source as the identity-only marker `start`.
  // It must never overwrite a real status, because these files seed the dots at launch and this event also fires mid-session — the script guards that too.
  ['SessionStart', 'start'],
];

/**
 * A hook script Claude runs on each event.
 * It reports only for sessions launched by claude-ui (CLAUDE_UI set), reads what it needs from the JSON on stdin, and writes a status file the app watches.
 * Dependency-free and always exits 0.
 * A hook has about a second before Claude Code moves on, so nothing here may wait on anything.
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
# An end the app reports from the transcript names the statuses it ends and the second the status it read was written; it is checked against the file at the last moment, below.
expect="$(field claude_ui_expect)"
expect_ts="$(field claude_ui_expect_ts)"
# A subagent's events carry the session's own id, told apart by agent_id.
# Once the session's turn has ended, a subagent still at work runs in the background, and its tool calls are not the session working again.
# Waiting still goes through: it needs you, whoever asks.
if [ "$status" = busy ] && [ -n "$(field agent_id)" ] && grep -qE '"status":"(idle|background)"' "$dir/$sid.json" 2>/dev/null; then
  exit 0
fi
# A minute at its prompt without input (its default), claude sends an idle notice even while a shell it started still runs (measured), and by its source a monitor too.
# It is not waiting for you then: that work's end starts a turn of its own, and the notice a minute after that turn is the one that says waiting.
# Every other notification, a permission prompt or a question, needs you and goes through.
if [ "$status" = waiting ] && [ "$(field notification_type)" = idle_prompt ] && grep -q '"status":"background"' "$dir/$sid.json" 2>/dev/null; then
  exit 0
fi
# A permission prompt's own notice comes about six seconds after its PermissionRequest wrote waiting, for the same question.
# Writing it again would only take a read mark off a dot muted meanwhile.
if [ "$status" = waiting ] && [ "$(field notification_type)" = permission_prompt ] && grep -q '"event":"PermissionRequest"' "$dir/$sid.json" 2>/dev/null; then
  exit 0
fi
# What runs behind the session, kept for the app beside its status: the payload of the last Stop, which lists that work, or nothing from a fresh start.
# The app reads it when the transcript shows a turn ending with no hook to say so (an interrupt), or work ending without a turn (stopped from claude's task list).
# A compaction is the same claude going on, so its SessionStart keeps what the last Stop said.
# A Stop's is written with its status, below, so an end the app reports and the script then drops leaves it as it was.
keep_stop=''
if [ "$status" = idle ]; then
  keep_stop=1
elif [ "$status" = start ] && [ "$(field source)" != compact ]; then
  printf '{}' > "$dir/$sid.stop"
  # Which session this terminal runs from now, and why, in a file of its own as a model switch is: the status file below keeps a status it already has, so a resume into a session that has one would otherwise reach the app only with its next prompt.
  # Written before that status file, though the app may still hear either first: it reads each file as it changes, and the reads can finish in either order.
  printf '{"tab":"%s","source":"%s"}' "\${CLAUDE_UI_TAB:-}" "$(field source)" > "$dir/$sid.start"
fi
# Stop lists the work still running behind the turn it ends, and while any runs the session has not finished: it reports background in idle's place, with the type claude gives each piece of work.
# Only a "type" key can match, never one inside a string, whose quotes arrive escaped; Stop's own fields have none, so each match is one entry of the list.
# An artifact claude watches for comments is listed as a monitor while the watch lasts, and nothing runs meanwhile: a comment sent to Claude summons a turn of its own (by claude's source), as a scheduled wakeup starts one.
# So each watch takes one monitor off the list, and a list of nothing but watches is idle.
# Claude starts a watch's description with the same words every time, and the same key-and-value match keeps one inside a string from counting.
extra=''
if [ "$status" = idle ] && printf '%s' "$input" | grep -qE '"background_tasks"[[:space:]]*:[[:space:]]*\\[[[:space:]]*\\{'; then
  entries="$(printf '%s' "$input" | grep -oE '"type"[[:space:]]*:' | wc -l)"
  watches="$(printf '%s' "$input" | grep -oE '"description"[[:space:]]*:[[:space:]]*"live updates for artifact ' | wc -l)"
  if (( watches == 0 || entries > watches )); then
    status=background
    types="$(printf '%s' "$input" | grep -oE '"type"[[:space:]]*:[[:space:]]*"[A-Za-z0-9 _.-]+"' | sed -E 's/.*("[^"]+")$/\\1/' | awk -v n="$watches" '$0 == "\\"monitor\\"" && n > 0 { n--; next } { print }' | paste -sd, -)"
    extra=",\\"background\\":[$types]"
  fi
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
# The event goes along because one status is several events, and the app asks of one of them in particular: a prompt submitted says a session asked to leave has stayed.
printf -v line '{"status":"%s","ts":%s,"tab":"%s","event":"%s"%s}' "$status" "$(date +%s)" "\${CLAUDE_UI_TAB:-}" "$(field hook_event_name)" "$extra"
# An end the app reports stands only over the status it read, of the same second: one a hook has written since, a Stop above all, keeps its word.
# Last, and with builtins only, so a hook has the fewest instants to land between this look and the write.
if [ -n "$expect" ]; then
  current=''
  { read -r current < "$dir/$sid.json"; } 2>/dev/null
  pattern="\\"status\\":\\"($expect)\\",\\"ts\\":$expect_ts,"
  [[ $current =~ $pattern ]] || exit 0
fi
[ -n "$keep_stop" ] && printf '%s' "$input" > "$dir/$sid.stop"
printf '%s\\n' "$line" > "$dir/$sid.json"
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
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as typeof settings;
  } catch (error) {
    // Missing means nothing we polluted; malformed means it must not be touched, and is worth a line, since hooks are exactly what a broken settings file breaks.
    const failure = fsFailure(error);
    if (failure) log('info', 'hooks', `left ${settingsPath} alone: ${failure}`);
    return;
  }
  if (!settings.hooks) return;

  const cleaned: string[] = [];
  for (const event of Object.keys(settings.hooks)) {
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(
      // `includes`, not `startsWith`: the command is quoted now, and the entries being cleaned up here were written by versions that did not quote it.
      (entry) => !entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(hookScriptPath)),
    );
    if (kept.length === entries.length) continue;
    cleaned.push(event);
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  if (cleaned.length === 0) return;
  // Keep the file's trailing newline (JSON.stringify omits it) so cleanup leaves no spurious diff.
  // Atomic, since this is the user's own file and a crash mid-write must not leave it cut short.
  await writeFileAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  // A write to a file that is the user's, not the app's, so it is said where it can be found.
  log('info', 'hooks', `removed an older version's status hooks from ${settingsPath}: ${cleaned.join(' ')}`);
}

/** Watch the status directory and push per-session status updates to the renderer. */
export function registerStatusIpc(getWindow: () => BrowserWindow | null): void {
  mkdirSync(statusDir, { recursive: true });

  ipcMain.handle('status:getAll', () => readAllStatuses());
  // Only once its claude has gone, so what its last Stop left running goes too.
  ipcMain.on('status:clear', (_event, id: string) => {
    for (const file of [`${id}.json`, `${id}.stop`, `${id}.start`]) void fs.rm(path.join(statusDir, file)).catch(() => {});
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
    // What the last Stop left scheduled, rewritten with each Stop's payload and with an end the app reports (`reportEnd`), and emptied by a start that is not a compaction's: a fact about the session, like a model switch, so its own channel, since a status that is not the Stop's must not take it away.
    // A file that does not parse, as one read halfway through its write does not, is skipped rather than sent as nothing, so a clock does not blink off and on; one that is gone is nothing.
    if (filename.endsWith('.stop')) {
      const id = filename.slice(0, -'.stop'.length);
      void readScheduled(id).then((tasks) => {
        const win = getWindow();
        if (tasks && win && !win.isDestroyed()) win.webContents.send('session:scheduled', id, tasks);
      });
      return;
    }
    // A claude starting on a session, which is identity rather than a state, and like a model switch not read at launch: the tabs restored then say which session each runs.
    if (filename.endsWith('.start')) {
      const id = filename.slice(0, -'.start'.length);
      void readStart(id).then((start) => {
        const win = getWindow();
        if (start && win && !win.isDestroyed()) win.webContents.send('session:start', id, start.tab, start.source);
      });
      return;
    }
    if (!filename.endsWith('.json')) return;
    const id = filename.replace(/\.json$/, '');
    void readStatus(id).then((entry) => {
      if (entry === null) return;
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('session:status', id, entry.status, entry.tab, entry.event, entry.background);
    });
  });
}

/** What a claude starting on a session wrote: the terminal it runs in (TAB_ENV) and SessionStart's source; null when the file is gone or not one. */
async function readStart(id: string): Promise<{ tab: string; source: string } | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, `${id}.start`), 'utf8')) as { tab?: unknown; source?: unknown };
    return { tab: typeof parsed.tab === 'string' ? parsed.tab : '', source: typeof parsed.source === 'string' ? parsed.source : '' };
  } catch {
    return null;
  }
}

interface StatusEntry {
  status: string;
  /** The second the script wrote it, as the script stamps it; null from a file without one. */
  ts: number | null;
  /** The terminal that reported it (TAB_ENV), or '' for a session claude-ui is not running. */
  tab: string;
  /** The hook event that reported it, or '' from a file written before the script named it. */
  event: string;
  /** For `background`, the type claude gives each piece of work still running, as many as the script could read; absent for any other status. */
  background?: string[];
}

async function readStatus(id: string): Promise<StatusEntry | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, `${id}.json`), 'utf8')) as {
      status?: unknown;
      ts?: unknown;
      tab?: unknown;
      event?: unknown;
      background?: unknown;
    };
    if (typeof parsed.status !== 'string') return null;
    return {
      status: parsed.status,
      ts: Number.isInteger(parsed.ts) ? (parsed.ts as number) : null,
      tab: typeof parsed.tab === 'string' ? parsed.tab : '',
      event: typeof parsed.event === 'string' ? parsed.event : '',
      ...(Array.isArray(parsed.background) ? { background: parsed.background.filter((type): type is string => typeof type === 'string') } : {}),
    };
  } catch {
    return null;
  }
}

/** A piece of background work as `Stop` lists it, reduced to what the app reads. */
export interface Work {
  id: string;
  /** What claude calls it, such as `shell` or `subagent`. */
  type: string;
  /** Claude's description of it, kept so that an end reported in a hook's place hands the script what it tells an artifact watch by. */
  description?: string;
}

/** What the hooks last reported of a session, with when, for a reader that ends what no hook ends. */
export interface Report {
  status: string;
  /** When the status was written, in ms since the epoch. */
  at: number;
  /** The second the script stamped it with, which an end reported in a hook's place names so the script can tell it from a status written since; null without one. */
  ts: number | null;
  tab: string;
  /** The work the last Stop listed as still running, or none from a fresh start. */
  running: Work[];
  /** When that Stop was, in ms since the epoch; never, for a session with no Stop file, so nothing found after it counts as running. */
  runningAt: number;
  /** The tasks that Stop listed as scheduled (`session_crons`), as claude wrote them, for an end reported in a hook's place to keep (`reportEnd`); absent when the file holds no list, as a start's does, which such an end must not turn into an empty one. */
  crons?: unknown[];
  /** The session's transcript, as that Stop named it, kept with the list so its crons can still be told from its wakeups (`cronSchedules`). */
  transcript?: string;
}

/** The last report of a session, or null for one with no status: one claude-ui is not running. */
export async function readReport(id: string): Promise<Report | null> {
  const entry = await readStatus(id);
  if (!entry) return null;
  const at = await mtimeOf(path.join(statusDir, `${id}.json`));
  if (at === null) return null;
  const stopFile = path.join(statusDir, `${id}.stop`);
  let running: Work[] = [];
  let runningAt = Infinity;
  let crons: unknown[] | undefined;
  let transcript: string | undefined;
  try {
    const stop = JSON.parse(await fs.readFile(stopFile, 'utf8')) as { background_tasks?: unknown; listed_at?: unknown; session_crons?: unknown; transcript_path?: unknown };
    if (Array.isArray(stop.session_crons)) crons = stop.session_crons;
    if (typeof stop.transcript_path === 'string') transcript = stop.transcript_path;
    // An end the app reported carries the time of the Stop its list came from, since the list is that Stop's, less what had ended; a Stop's own is when it was written.
    runningAt = typeof stop.listed_at === 'number' ? stop.listed_at : ((await mtimeOf(stopFile)) ?? Infinity);
    if (Array.isArray(stop.background_tasks)) {
      running = (stop.background_tasks as ({ id?: unknown; type?: unknown; description?: unknown } | null)[]).flatMap((work) =>
        typeof work?.id === 'string' && typeof work.type === 'string'
          ? [{ id: work.id, type: work.type, ...(typeof work.description === 'string' ? { description: work.description } : {}) }]
          : [],
      );
    }
  } catch {
    // No Stop file, or one that does not parse: nothing is known to run, and nothing the transcript says was started counts as running since.
  }
  return { status: entry.status, at, ts: entry.ts, tab: entry.tab, running, runningAt, ...(crons ? { crons } : {}), ...(transcript ? { transcript } : {}) };
}

/**
 * The tasks a session's last Stop left scheduled, from its `session_crons`, each entry without a prompt left out; none for a session with no Stop file, whose claude has gone.
 * Null, so the caller sends nothing, for what says nothing of them: a file that does not parse, such as one read while the script is still writing it (it truncates first), and one with no `session_crons` at all, which is what a start other than a compaction's writes (`{}`).
 * A claude started again has reported nothing yet, and its start's file is not news that nothing is scheduled: what it brings back shows from its first Stop, until when its tab goes on showing what it had when it stopped.
 */
export async function readScheduled(id: string): Promise<ScheduledTask[] | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(statusDir, `${id}.stop`), 'utf8');
  } catch {
    return [];
  }
  let stop: { session_crons?: unknown; transcript_path?: unknown };
  try {
    stop = JSON.parse(text) as { session_crons?: unknown; transcript_path?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(stop.session_crons)) return null;
  const listed = stop.session_crons as ({ id?: unknown } | null)[];
  // Which of them are crons, and on what schedule, only the transcript says (`cronSchedules`).
  const schedules = listed.length > 0 && typeof stop.transcript_path === 'string' ? await cronSchedules(stop.transcript_path) : new Map<string, string>();
  return scheduledTasksOf(listed.map((task) => (typeof task?.id === 'string' && schedules.has(task.id) ? { ...task, cron: schedules.get(task.id) } : task)));
}

/** How far each transcript has been read for its crons, the line cut off at the end of that read, and the schedules found. */
const cronsRead = new Map<string, { offset: number; decoder: StringDecoder; rest: string; schedules: Map<string, string> }>();
/** The last look at each transcript, which the next one waits for. */
const cronsLooked = new Map<string, Promise<unknown>>();

/**
 * Each cron a session's claude made, by its id, with its schedule in claude's words: the result of each `CronCreate` call in the transcript, `{"id": "34f607db", "humanSchedule": "Every 10 minutes", …}`, whose id is the one its `Stop` list names.
 * Seen in session f3829708 on 2026-10-24, for a cron's id, and against a `/loop` wakeup's, whose `ScheduleWakeup` result carries no id at all.
 * A subagent's calls are kept in a transcript of their own (seen in session 2e8cf79b, whose own transcript holds none of them), so a cron a subagent made would not be found here; not tried.
 * One look at a time per transcript: two at once would each go on from the same place, and the look after them would start past what was written since.
 */
function cronSchedules(transcript: string): Promise<ReadonlyMap<string, string>> {
  const look = (cronsLooked.get(transcript) ?? Promise.resolve()).then(() => lookForCrons(transcript));
  cronsLooked.set(transcript, look.catch(() => undefined));
  return look;
}

/** One look for crons, read on from where the last stopped, since a transcript only grows and can run to tens of megabytes; one that shrank is read again from its start. */
async function lookForCrons(transcript: string): Promise<ReadonlyMap<string, string>> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(transcript, 'r');
  } catch {
    return cronsRead.get(transcript)?.schedules ?? new Map();
  }
  try {
    const { size } = await handle.stat();
    let seen = cronsRead.get(transcript);
    if (!seen || size < seen.offset) {
      seen = { offset: 0, decoder: new StringDecoder('utf8'), rest: '', schedules: new Map() };
      cronsRead.set(transcript, seen);
    }
    const chunk = Buffer.alloc(1 << 20);
    while (seen.offset < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - seen.offset), seen.offset);
      if (bytesRead === 0) break;
      seen.offset += bytesRead;
      const lines = (seen.rest + seen.decoder.write(chunk.subarray(0, bytesRead))).split('\n');
      seen.rest = lines.pop() ?? '';
      for (const line of lines) {
        // Most lines are not a cron's result; only the ones that could be are parsed.
        if (!line.includes('"humanSchedule"')) continue;
        try {
          const result = (JSON.parse(line) as { toolUseResult?: { id?: unknown; humanSchedule?: unknown } }).toolUseResult;
          if (typeof result?.id === 'string' && typeof result.humanSchedule === 'string') seen.schedules.set(result.id, result.humanSchedule);
        } catch {
          // A line that does not parse names no cron.
        }
      }
    }
    return seen.schedules;
  } finally {
    await handle.close();
  }
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** An end of a state that no hook reports, as the app reports it in the hook's place. */
export interface Ending {
  /** What the status file names as having reported it. */
  event: string;
  /** Idle as a Stop writes it, so background while `running` holds anything; or busy, for a turn that goes on. */
  status: 'idle' | 'busy';
  /** For idle, the work still listed as running. */
  running: Work[];
  /** The statuses it ends: the script writes it only over one of these, stamped as the report it read was. */
  ends: readonly string[];
}

/**
 * Report an end that no hook reports by running the hook script as the hook would have, so the script stays the one writer of the status files: an idle reads exactly as a Stop's would, idle or background naming that work.
 * `report` is the one the end was read from: the script writes only over that status of that second, and keeps with the work still running the time of the Stop it was taken from, so that work ending after that Stop still counts as ended, even before this report is written.
 */
export function reportEnd(id: string, report: Report, ending: Ending): Promise<void> {
  const { tab, ts, runningAt: listedAt } = report;
  return new Promise((resolve) => {
    const child = spawn(hookScriptPath, [ending.status], { env: { ...process.env, [SCOPE_ENV]: '1', [TAB_ENV]: tab }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      log('warn', 'status', `could not report ${ending.event} for ${id}: ${errorText(error)}`);
      resolve();
    });
    child.on('close', () => resolve());
    // Without a Stop to take it from, the report is the first list, as a Stop's would be.
    const listed = Number.isFinite(listedAt) ? { listed_at: listedAt } : {};
    // What that Stop left scheduled goes with it, since the script writes this over the Stop's file: an interrupt leaves a cron as it was, though it takes a `/loop` wakeup with it (by claude's source), which the next Stop says.
    const crons = report.crons ? { session_crons: report.crons, ...(report.transcript ? { transcript_path: report.transcript } : {}) } : {};
    const stop = ending.status === 'idle' ? { background_tasks: ending.running, ...crons, ...listed } : {};
    child.stdin.end(JSON.stringify({ session_id: id, hook_event_name: ending.event, claude_ui_expect: ending.ends.join('|'), claude_ui_expect_ts: String(ts ?? ''), ...stop }));
  });
}

/** Remove everything this directory holds for the given session ids (used when a conversation is deleted). */
export async function clearStatuses(ids: string[]): Promise<void> {
  const files = ids.flatMap((id) => [`${id}.json`, `${id}.model`, `${id}.stop`]);
  await Promise.all(files.map((file) => fs.rm(path.join(statusDir, file)).catch(() => {})));
}

/**
 * Every session's status as the renderer receives it at launch.
 * Exported for the tests that pin what does and does not survive into it.
 */
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
