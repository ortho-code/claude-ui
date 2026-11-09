# The log and the usage record

## The log

An installed build is started from a launcher, so it has no stdout: the log is where what a launch did can be read afterwards, on somebody else's machine.
The main process writes it (`src/main/logs/log.ts`), and the window's own lines reach it through the preload bridge, checked on arrival: a known level, an area that is one short lowercase word so no area can forge a line, text only, cut at 4,000 characters.

**One file per launch per date**, in `app.getPath('logs')` — `~/.config/claude-ui/logs` on Linux, `~/Library/Logs/Claude UI` on macOS — named by the local moment it started, `claude-ui-20260928143012.log` ([decided 2026-09-28](../decisions/0023-one-log-file-per-launch-per-date.md)).
Each opens with a header: its own path, the version, how the app was installed, the OS, the Electron and Chromium versions and, on Linux, the display variables.
A run that crosses midnight starts a new file on its first write of the new date — a write rather than a timer, which cannot be trusted across sleep — and that file repeats the header and names the one it continues, so every file stands on its own.
The folder is read in `paths.ts` below the `userData` pin and nowhere else, because the call creates it as a side effect, and on Linux, made before the pin, it resolves under the product name and leaves a stray `~/.config/Claude UI/logs` behind.

**There is no size cap.**
The date roll keeps a file readable and loses nothing within a run ([decided 2026-09-28](../decisions/0026-the-log-has-no-size-cap.md)).
What bounds the likeliest runaway, an error thrown on every frame, is that identical lines in a row collapse into one line and a count, and the count is written within five seconds, so a crash in the middle of a flood still leaves it.
A failure met on every pass of something that repeats — a transcript that cannot be read, at every listing — is written once per file instead, since other lines come between the repeats.

**Retention** keeps the files of the 7 most recent dates that have a log — dates with one, not calendar days, so two weeks away does not empty the folder — and runs whenever a file starts.
The numbers live in `src/shared/helpers/log.ts`, because Settings states them.

**A crash log** is a file whose launch did not end with its quit line, or in which a process of the app died: an uncaught exception or unhandled rejection in main, the renderer gone, the GPU process gone.
It is renamed `…-crash.log` and kept apart, the 20 newest.
From the inside, a native crash, a kill, a WSL shutdown and a power cut look the same, so the next launch appends "this launch ended without quitting" to the file rather than a guess at why; it only checks the newest ordinary file, which is the previous launch's last.
Only the file where it happened is marked, not every file of a run that lasted several days.

**Deleting the logs while the app runs is safe**, since Settings invites it.
Writes go by path, with `O_APPEND` and no `O_CREAT`, so a file that has gone is noticed rather than silently recreated without its header, and the line that noticed starts a new file the way midnight does.

**Uncaught errors are observed, not handled.**
The log listens on `uncaughtExceptionMonitor`, never `uncaughtException`: Electron shows its "A JavaScript error occurred in the main process" dialog only while it is the one listener for the latter, so a listener here would take that dialog away in silence.
The monitor also receives unhandled rejections, which Node raises as uncaught exceptions, and a test pins that the listener count does not change.
The window's uncaught errors arrive through `console-message` as `Uncaught …` lines — measured, not assumed — so forwarding its warnings and errors is its crash reporting too.

**What is written**: each terminal's start, with its pid (which the SIGKILL line names), its stop and its end; panel runs that fail; the layout file's state when it changes; a folder that cannot be watched, when the reason is anything but "not there"; which copy of `meta.json` the app went on with when it had to recover one; git missing or timing out; the GPU status whenever it changes; and which renderer the terminals draw with.
**What is not**: prompts, transcript text, session and worktree names, the value of a flag, a panel's command line or its output.
The one exception is a failed start's last five lines, which for a resume that dies at once can include some of the history it had just drawn.

## The usage record

`usage.log` in `app.getPath('userData')`, beside `meta.json`, is how the app's use is counted over weeks: how many sessions were decided, how often the review was used, and how noisy needs-you is ([decided 2026-11-08](../decisions/0200-the-apps-use-is-recorded-in-a-usage-log.md)).
`src/main/logs/usage.ts` owns it; each line is a moment as the log writes one (`appendStamped`) and a JSON event:
- `decide`: one per write of `finish`, `unfinish`, `markSetAside`, `clearSetAside`, `keep` or `unkeep`, named after the write, with the ids it changed (`setAside` and `keep` every id given, since each restamps its moment); `finish`, `unfinish`, `clearSetAside` and `unkeep` that changed nothing give no line.
  The act is the write's, not what you meant: an Undo writes whatever puts things back, so it can show as `finish`, `setAside` or `keep`.
  The two writes nobody decides carry `by`: `"by":"prompt"` on the `clearSetAside` each prompt you send makes, and `"by":"resume"` on the `unfinish` of a finished session resumed in claude.
- `review`: the review's `start` or `end`, with its scope (`project` or `all`) and how many sessions it offered to decide, each as of that moment.
  A review cut short by quitting or reloading has a start and no end, and a finish of a running tab is written when its claude exits, which can be after the review's end.
- `needsYou`: per session, the reasons a write `marked`, `settled` with what settled them (`SettledBy`), or `restored` by Undo, by type.

**Recorded in main, where `meta.json` is written** (`update` in `src/main/sessions/metastore.ts`), after the write has landed, so every surface that decides — the review, the bulk bar, the close toast, a session's menu, a tab's button — is counted without passing a source through; only the two writes nobody decides say what made them.
The window sends only the review's opening and ending, which `reviewUsageOf` checks on arrival as the log checks the window's lines.

**Not the audit log**: `meta-audit.log` is trimmed by size to trace a lost write over the last few sessions of work; this is kept by time, a year (`USAGE_KEPT_DAYS`), trimmed at each launch.
It repeats on purpose what the needs-you history keeps, since that history holds only the newest 20 per session and goes with a delete.

**What a line holds**: moments, session ids, types and counts; never a title, a prompt or a note.
A failed append is logged, each distinct error once per log file, and never fails the write it records.
Nothing in the app reads it yet: a count is a script over it and `meta.json`.
