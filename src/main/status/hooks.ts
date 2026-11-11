import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { statusDir, hookScriptPath, statusSettingsFile, shellQuote } from '../paths';
import { fsFailure, log } from '../logs/log';
import { writeFileAtomic } from '../files/atomic';

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
  // Ready, or `background` while work the turn started still runs: its payload lists that work (`background_tasks`, measured on claude 2.1.289), and the script reads it.
  // For a shell, a monitor and a subagent (measured), the work's end starts a turn of its own, so the next `Stop` brings the list up to date without anything else to hook.
  ['Stop', 'ready'],
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
  // The app cannot get this anywhere else while a session sits ready — a transcript records only which model ANSWERED, so `/model` is invisible in it until the next reply, and the row went on naming the old model in the meantime.
  // MEASURED: the payload carries `from_model`, `to_model`, `requested_model` and `source`; `to_model` is the one that matters and is a full model id.
  ['PostModelSwitch', 'model'],
  // Compaction is claude WORKING — it is thinking about the transcript — so the dot belongs on busy until it finishes, and the finish is a `SessionStart` carrying `source=compact` (see the script).
  // `PostCompact` would be the obvious end signal, but a probe on 2026-08-29 never observed it firing and could not prove it ever does; `SessionStart` was observed.
  ['PreCompact', 'busy'],
  // Two jobs, and only one of them is a status.
  // IDENTITY, always: the payload's session id is what this terminal is running NOW, which is how a tab follows a `/clear` or claude's own `/resume` onto the session that replaced it; the script writes it with its source to a file of its own (`<id>.start`), since the status file below keeps a status it already has.
  // A STATUS, only for `source=compact`, where it means the compaction above has ended; the script turns that one into `ready` and leaves every other source as the identity-only marker `start`.
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
if [ "$status" = busy ] && [ -n "$(field agent_id)" ] && grep -qE '"status":"(ready|background)"' "$dir/$sid.json" 2>/dev/null; then
  exit 0
fi
# Notices of something finished ask nothing: a login done, an agent finished or failed, claude done using your computer (where claude 2.1.310 sends them), an MCP server's form confirmed complete and the answer it was given (claude 2.1.316).
# Every other kind goes through as waiting, one claude may add later included, since missing a question is worse than a waiting too many.
if [ "$status" = waiting ]; then
  case "$(field notification_type)" in
    auth_success | agent_completed | computer_use_exit | elicitation_complete | elicitation_response) exit 0 ;;
  esac
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
if [ "$status" = ready ]; then
  keep_stop=1
elif [ "$status" = start ] && [ "$(field source)" != compact ]; then
  printf '{}' > "$dir/$sid.stop"
  # Which session this terminal runs from now, and why, in a file of its own as a model switch is: the status file below keeps a status it already has, so a resume into a session that has one would otherwise reach the app only with its next prompt.
  # Written before that status file, though the app may still hear either first: it reads each file as it changes, and the reads can finish in either order.
  printf '{"tab":"%s","source":"%s"}' "\${CLAUDE_UI_TAB:-}" "$(field source)" > "$dir/$sid.start"
fi
# A minute at its prompt without input (its default), claude sends an idle notice, which says the turn is done, not that it asks you anything: that is ready.
# Nothing over ready or background, which say as much already and keep their read mark and their work list, and nothing over waiting, which a question still open says better.
# Below the Stop's keeping, so its payload is not kept as a Stop's; every other notification, such as a permission prompt or a question, goes through as waiting.
if [ "$status" = waiting ] && [ "$(field notification_type)" = idle_prompt ]; then
  grep -qE '"status":"(ready|background|waiting)"' "$dir/$sid.json" 2>/dev/null && exit 0
  status=ready
fi
# Stop lists the work still running behind the turn it ends, and while any runs the session is not ready: it reports background in ready's place, with the type claude gives each piece of work.
# Only a "type" key can match, never one inside a string, whose quotes arrive escaped; Stop's own fields have none, so each match is one entry of the list.
# An artifact claude watches for comments is listed as a monitor while the watch lasts, and nothing runs meanwhile: a comment sent to Claude summons a turn of its own (by claude's source), as a scheduled wakeup starts one.
# So each watch takes one monitor off the list, and a list of nothing but watches is ready.
# Claude starts a watch's description with the same words every time, and the same key-and-value match keeps one inside a string from counting.
extra=''
if [ "$status" = ready ] && printf '%s' "$input" | grep -qE '"background_tasks"[[:space:]]*:[[:space:]]*\\[[[:space:]]*\\{'; then
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
  status=ready
fi
# Every other SessionStart carries identity only, so it must not overwrite a status: these files seed the dots at launch, and the event fires on clear and compact MID-session, where a session already has a status worth keeping.
# A brand-new session has no file yet, which is the case this still writes for.
if [ "$status" = start ] && [ -e "$dir/$sid.json" ]; then
  exit 0
fi
# A prompt goes along with its status, so the app can tell yours from a turn claude starts itself, which fires UserPromptSubmit too (startedByClaude, src/shared/status/scheduled.ts).
# Taken as the payload holds it, a JSON string's inside, escapes and all, so it is one in the line as well.
if [ "$status" = busy ] && [ "$(field hook_event_name)" = UserPromptSubmit ]; then
  said="$(printf '%s' "$input" | grep -oE '"prompt"[[:space:]]*:[[:space:]]*"([^"\\\\]|\\\\.)*"' | head -1 | sed -E 's/^"prompt"[[:space:]]*:[[:space:]]*"//; s/"$//')"
  extra="$extra,\\"prompt\\":\\"$said\\""
  # Claude's own word for where the prompt came from, which its hook schema names and 2.1.310 did not yet send.
  from="$(field source)"
  [ -n "$from" ] && extra="$extra,\\"source\\":\\"$from\\""
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
