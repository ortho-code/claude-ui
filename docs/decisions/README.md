# Decisions

What was decided about how claude-ui works, when, and why, each with what was turned down.
The architecture notes describe the app as it is now and link here for the reasoning.

| # | Date | Decision | Area |
|---|---|---|---|
| [0001](0001-project-scope-holds-in-finished-view.md) | 2026-08-27 | The project scope holds in the finished view too | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0002](0002-decisive-button-filled.md) | 2026-08-29 | A dialog's decisive button is filled, its colour named once | [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes) |
| [0003](0003-a-cleared-session-starts-empty.md) | 2026-09-22 | A cleared session is a session with nothing in it | [A cleared session is a new session](../architecture/claude.md#a-cleared-session-is-a-new-session) |
| [0004](0004-no-group-sweep-after-the-leader-exits.md) | 2026-09-22 | The process group is not swept again after its leader exits | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0005](0005-tab-bar-uses-the-project-order.md) | 2026-09-22 | The tab bar orders projects in the order you set | [Traps worth knowing](../architecture/ui-conventions.md#traps-worth-knowing) |
| [0006](0006-the-app-mints-the-session-id.md) | 2026-09-22 | The app chooses the session id | [The app chooses the session id](../architecture/claude.md#the-app-chooses-the-session-id) |
| [0007](0007-the-launcher-refuses-a-missing-folder.md) | 2026-09-22 | The launcher refuses a session whose folder is gone | [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone) |
| [0008](0008-the-title-on-disk-stays-as-claude-code-writes-it.md) | 2026-09-22 | The title on disk stays as Claude Code writes it | [A cleared session is a new session](../architecture/claude.md#a-cleared-session-is-a-new-session) |
| [0009](0009-unavailable-is-aria-disabled.md) | 2026-09-22 | Unavailable is aria-disabled, never the disabled property | [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone) |
| [0010](0010-a-closed-filter-panel-folds-to-chips.md) | 2026-09-23 | A closed filter panel folds down to chips of what is on | [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it) |
| [0011](0011-closing-the-filter-panel-keeps-the-filter.md) | 2026-09-23 | Closing the filter panel keeps the filter, and its toggle is a funnel | [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it) |
| [0012](0012-fold-chevron-on-divider.md) | 2026-09-23 | A group folds from a faint chevron on a divider | [Dividers and folding](../architecture/panels.md#dividers-and-folding) |
| [0013](0013-keep-interactive-login-shell.md) | 2026-09-23 | A command runs in an interactive login shell | [How a command runs](../architecture/panels.md#how-a-command-runs) |
| [0014](0014-rail-over-tab-strip.md) | 2026-09-23 | A group switches panels from a rail of icons | [Several panels in a group](../architecture/panels.md#several-panels-in-a-group) |
| [0015](0015-shared-divider-chevrons-in-a-row.md) | 2026-09-23 | Two chevrons on one divider sit one after the other | [Dividers and folding](../architecture/panels.md#dividers-and-folding) |
| [0016](0016-exited-shell-restarts-on-key.md) | 2026-09-24 | An exited shell comes back on a key press | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0017](0017-fixed-command-no-rerun-on-switch.md) | 2026-09-24 | A fixed command panel does not run again on a switch | [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option) |
| [0018](0018-layout-entry-options-nested.md) | 2026-09-24 | A panel's own settings nest under options | [The layout file](../architecture/panels.md#the-layout-file) |
| [0019](0019-relative-cwd-no-config-fallback.md) | 2026-09-24 | A relative cwd never falls back to the config folder | [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option) |
| [0020](0020-type-checks-its-own-options.md) | 2026-09-24 | A panel type checks its own options | [A type owns its options](../architecture/panels.md#a-type-owns-its-options) |
| [0021](0021-a-gone-project-is-marked-not-hidden.md) | 2026-09-28 | A project whose folder is gone is marked, not hidden | [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone) |
| [0022](0022-flash-has-no-end-keyframe.md) | 2026-09-28 | The jump's flash has no end keyframe | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0023](0023-one-log-file-per-launch-per-date.md) | 2026-09-28 | One log file per launch per date | [The log](../architecture/logs.md#the-log) |
| [0024](0024-shown-icon-folds-group.md) | 2026-09-28 | The shown panel's rail icon folds its group | [Several panels in a group](../architecture/panels.md#several-panels-in-a-group) |
| [0025](0025-tab-bar-project-labels-are-full-colour.md) | 2026-09-28 | The tab bar's project labels are in full text colour | [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone) |
| [0026](0026-the-log-has-no-size-cap.md) | 2026-09-28 | The log has no size cap | [The log](../architecture/logs.md#the-log) |
| [0027](0027-bar-and-loupe-take-no-focus.md) | 2026-09-29 | The bar and the loupe take no focus | [The bar and the loupe](../architecture/history.md#the-bar-and-the-loupe) |
| [0028](0028-bar-lights-marks-in-band.md) | 2026-09-29 | The bar lights the marks inside its band | [The bar and the loupe](../architecture/history.md#the-bar-and-the-loupe) |
| [0029](0029-bar-press-is-a-scrollbar.md) | 2026-09-29 | A press on the bar goes there at once | [The bar and the loupe](../architecture/history.md#the-bar-and-the-loupe) |
| [0030](0030-code-block-without-a-rule.md) | 2026-09-29 | A code block has no rule down its side | [What it looks like](../architecture/history.md#what-it-looks-like) |
| [0031](0031-cold-tab-history-on-request.md) | 2026-09-29 | A tab with no claude shows its history only on request | [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out) |
| [0032](0032-each-tab-keeps-its-history-place.md) | 2026-09-29 | Each tab keeps its place in the history | [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out) |
| [0033](0033-history-drawn-in-slices.md) | 2026-09-29 | The history is drawn in slices, newest first and then oldest up | [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out) |
| [0034](0034-history-in-claudes-face.md) | 2026-09-29 | The history reads in claude's face, a step smaller | [What it looks like](../architecture/history.md#what-it-looks-like) |
| [0035](0035-history-is-a-drawer.md) | 2026-09-29 | The history is a drawer from the bar | [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out) |
| [0036](0036-history-opens-only-on-purpose.md) | 2026-09-29 | The history opens only on purpose | [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out) |
| [0037](0037-loupe-for-exact-entries.md) | 2026-09-29 | A loupe reaches one exact entry from the bar | [The bar and the loupe](../architecture/history.md#the-bar-and-the-loupe) |
| [0038](0038-markdown-it-with-html-off.md) | 2026-09-29 | A reply is rendered by markdown-it with raw HTML off | [A reply is untrusted text](../architecture/history.md#a-reply-is-untrusted-text) |
| [0039](0039-pin-star-in-the-gutter.md) | 2026-09-29 | A pin's star stands in the gutter | [Pins](../architecture/history.md#pins) |
| [0040](0040-pinned-filter-is-a-labelled-switch.md) | 2026-09-29 | The pinned filter is a labelled switch | [Pins](../architecture/history.md#pins) |
| [0041](0041-reply-kept-as-parts.md) | 2026-09-29 | A reply is kept as parts, in the order claude wrote them | [What it looks like](../architecture/history.md#what-it-looks-like) |
| [0042](0042-script-describes-app-acts.md) | 2026-09-29 | A panel type's script describes and the app acts | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0043](0043-shared-type-folder-needs-no-trust-step.md) | 2026-09-29 | A shared panel type folder needs no trust step | [The config folder](../architecture/config.md#the-config-folder) |
| [0044](0044-broken-run-keeps-list.md) | 2026-09-30 | A broken list run never shows an empty list | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0045](0045-panel-links-forgotten-when-session-gone.md) | 2026-09-30 | A panel's link to a session is forgotten when the session is gone | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0046](0046-rail-count-inside-button.md) | 2026-09-30 | A rail icon's count sits inside the button | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0047](0047-open-look-shares-the-hover-rule.md) | 2026-10-01 | A trigger's open look shares its hover rule | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0048](0048-shared-settings-need-no-trust-step.md) | 2026-10-05 | A shared settings file needs no trust step | [The config folder](../architecture/config.md#the-config-folder) |
| [0049](0049-a-cd-into-a-worktree-is-not-a-worktree-session.md) | 2026-10-07 | A Bash cd into a worktree does not make a worktree session | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0050](0050-a-failed-start-leaves-the-tab-cold.md) | 2026-10-07 | A failed start leaves its tab cold | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0051](0051-a-panel-shell-is-asked-with-sighup.md) | 2026-10-07 | A panel's shell is asked to stop with SIGHUP | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0052](0052-config-files-are-jsonc.md) | 2026-10-07 | Config files are JSONC | [The config folder](../architecture/config.md#the-config-folder) |
| [0053](0053-dragged-sizes-kept-per-node.md) | 2026-10-07 | A dragged size is kept per node | [Sizes](../architecture/panels.md#sizes) |
| [0054](0054-failed-tick-shows-output.md) | 2026-10-07 | A failed tick shows what it printed | [The `command` type](../architecture/panels.md#the-command-type) |
| [0055](0055-forcing-is-one-function.md) | 2026-10-07 | Forcing a session is one function, for every route | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0056](0056-interval-runs-out-of-sight.md) | 2026-10-07 | A command panel's interval runs out of sight too | [The `command` type](../architecture/panels.md#the-command-type) |
| [0057](0057-nothing-follows-the-presses.md) | 2026-10-07 | Nothing follows the presses of a stop | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0058](0058-preferences-live-in-the-config-folder.md) | 2026-10-07 | The app's preferences live in the config folder | [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups) |
| [0059](0059-the-force-grace-is-3-s.md) | 2026-10-07 | The grace before SIGKILL is 3 s | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0060](0060-tick-holds-output.md) | 2026-10-07 | A tick holds what is on show, a press clears it | [The `command` type](../architecture/panels.md#the-command-type) |
| [0061](0061-a-tab-is-12px-wider-for-its-kebab.md) | 2026-10-08 | A tab's width cap grows by its kebab | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0062](0062-a-tabs-kebab-always-shows.md) | 2026-10-08 | A tab's kebab always shows | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0063](0063-borderless-hover-turns-glyph-accent.md) | 2026-10-08 | A borderless icon control hovers by turning its glyph accent | [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes) |
| [0064](0064-restored-tabs-come-back-cold.md) | 2026-10-08 | Tabs that were running come back cold at launch | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0065](0065-watch-git.md) | 2026-10-08 | A panel watching git looks at a fingerprint every 30 seconds | [The `command` type](../architecture/panels.md#the-command-type) |
| [0066](0066-compact-row-own-shape.md) | 2026-10-13 | The compact list row is a shape of its own | [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes) |
| [0067](0067-a-project-move-passes-the-next-project-on-screen.md) | 2026-10-14 | A project's move passes the next project on screen | [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups) |
| [0068](0068-detail-lines-of-parts.md) | 2026-10-14 | A row's detail is lines of parts, with no string form | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0069](0069-list-option-as-json.md) | 2026-10-14 | A list option reaches the script as JSON | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0070](0070-list-says-how-many-buttons.md) | 2026-10-14 | A list says how many of a row's actions are buttons | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0071](0071-panel-types-folder-name.md) | 2026-10-14 | Panel types live in panel-types/ | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0072](0072-a-project-is-listed-while-it-has-sessions.md) | 2026-10-15 | A project is listed while it has sessions | [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups) |
| [0073](0073-header-actions-take-ordinary-hover.md) | 2026-10-15 | The sidebar's header actions take the ordinary button's hover | [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes) |
| [0074](0074-rail-and-view-glyph-never-blue.md) | 2026-10-15 | A rail icon's and a view switch's glyph never turns blue | [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes) |
| [0075](0075-close-reads-foreground-at-press.md) | 2026-10-16 | Closing a shell reads what runs at the press | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0076](0076-fold-chevron-turns-into-status-dot.md) | 2026-10-16 | The folded tab bar's chevron turns into a hidden tab's dot | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0077](0077-no-fold-chevron-on-one-row.md) | 2026-10-16 | The tab bar's chevron is there only with two or more rows | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0078](0078-only-you-make-a-shell.md) | 2026-10-16 | Only a press makes a shell | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0079](0079-shell-stays-in-its-project.md) | 2026-10-16 | A shell filed under a project stays in that project | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0080](0080-shells-are-tabs-not-group-entries.md) | 2026-10-16 | A terminal panel's shells are tabs inside it | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0081](0081-tab-bar-folds-from-a-line.md) | 2026-10-16 | The tab bar folds from a chevron on a line under it | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0082](0082-terminal-header-without-tabs.md) | 2026-10-16 | A terminal panel with no tab has the ordinary header | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0083](0083-terminal-rows-fold-in-all.md) | 2026-10-16 | A terminal panel's rows fold to one in All | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0084](0084-switch-rechecks-terminal-options.md) | 2026-10-17 | A switch checks a terminal panel's options again | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0085](0085-show-in-list-widens-to-all.md) | 2026-10-19 | Show in list widens the list to All | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0086](0086-the-dot-and-mark-as-read-share-one-rule.md) | 2026-10-19 | A session's dot and Mark as read share one rule | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0087](0087-the-kebab-is-complete.md) | 2026-10-19 | A session's kebab is complete and a button is a shortcut | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0088](0088-a-claude-resuming-a-held-session-is-forced-out.md) | 2026-10-20 | A claude that resumes a session another tab runs is forced out | [A resumed session is the session it was](../architecture/claude.md#a-resumed-session-is-the-session-it-was) |
| [0089](0089-a-git-repository-is-a-fact-about-its-folder.md) | 2026-10-20 | Whether a project is a git repository is answered by every session there | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0090](0090-a-headings-menu-starts-sessions-there.md) | 2026-10-20 | A heading's menu holds the ways to start a session there | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0091](0091-a-resume-into-a-finished-session-unfinishes-it.md) | 2026-10-20 | A resume into a finished session makes it unfinished | [A resumed session is the session it was](../architecture/claude.md#a-resumed-session-is-the-session-it-was) |
| [0092](0092-the-new-session-caret-is-on-every-heading.md) | 2026-10-20 | The new-session caret is on every heading | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0093](0093-the-order-of-a-headings-menu.md) | 2026-10-20 | The order of a heading's menu | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0094](0094-a-menu-item-does-what-it-says-or-nothing.md) | 2026-10-21 | A menu item does what it says or nothing | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0095](0095-an-unanswered-ask-is-never-forced.md) | 2026-10-21 | The app never forces a session because an ask went unanswered | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0096](0096-ctrl-v-pastes-under-wsl-only.md) | 2026-10-21 | Ctrl+V pastes under WSL, and only there | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0097](0097-edits-fold-with-tool-calls.md) | 2026-10-21 | An edit folds with the other tool calls, counted by file | [What it looks like](../architecture/history.md#what-it-looks-like) |
| [0098](0098-explorer-files-pasted-as-linux-paths.md) | 2026-10-21 | Files copied in Explorer paste as Linux paths | [The `terminal` type](../architecture/panels.md#the-terminal-type) |
| [0099](0099-open-kebab-menu-follows-store.md) | 2026-10-21 | An open kebab menu follows what it lists | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0100](0100-a-command-claude-runs-is-not-a-first-prompt.md) | 2026-10-22 | A command Claude runs itself is not a session's first prompt | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0101](0101-an-untitled-session-is-named-by-its-first-prompt.md) | 2026-10-22 | A session Claude has not titled is named by its first prompt | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0102](0102-pr-colours-come-from-the-list-tone-words.md) | 2026-10-22 | A PR's colour comes from the list's tone words | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0103](0103-pr-statuses-are-kept-in-memory-only.md) | 2026-10-22 | PR statuses are kept in main's memory only | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0104](0104-relative-times-on-a-clock.md) | 2026-10-22 | A time that says how long ago is drawn on a clock | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0105](0105-settings-are-one-file.md) | 2026-10-22 | Settings are one file, not a pair | [The config folder](../architecture/config.md#the-config-folder) |
| [0106](0106-slash-commands-in-the-history.md) | 2026-10-22 | A command claude runs itself counts as a request at once | [What counts as a request](../architecture/history.md#what-counts-as-a-request) |
| [0107](0107-starter-settings-file.md) | 2026-10-22 | A launch with no settings file writes one with every default | [The config folder](../architecture/config.md#the-config-folder) |
| [0108](0108-a-stop-not-left-says-so-without-a-hover.md) | 2026-10-24 | A stop claude has not left says so without a hover | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0109](0109-a-stopped-tab-keeps-a-muted-clock-for-its-crons.md) | 2026-10-24 | A stopped tab keeps a muted clock for its crons | [Status cues](../architecture/status-cues.md#status-cues) |
| [0110](0110-a-tasks-fate-is-said-not-asked.md) | 2026-10-24 | What becomes of a scheduled task is said, not asked at a stop | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0111](0111-app-names-panel-folder.md) | 2026-10-26 | The app names the folder a panel looks in | [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option) |
| [0112](0112-terminal-opens-in-unpadded-box.md) | 2026-10-26 | A terminal opens in an unpadded box of its own | [Traps worth knowing](../architecture/ui-conventions.md#traps-worth-knowing) |
| [0113](0113-where-a-session-works-is-its-last-changed-checkout.md) | 2026-10-26 | Where a session works is the checkout it last changed a file in | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0114](0114-checkout-pick-is-the-sessions.md) | 2026-10-27 | A picked checkout is the session's, not its tab's | [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option) |
| [0115](0115-menus-are-capped-at-300px.md) | 2026-10-27 | Every menu is capped at 300px, its first line cut and the rest wrapped | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0116](0116-the-clock-has-its-place-in-the-menu.md) | 2026-10-27 | The clock has its place in a session's menu | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0117](0117-a-called-off-finish-says-so.md) | 2026-10-28 | A prompt that calls a finish off says so | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0118](0118-a-close-or-finish-offers-undo.md) | 2026-10-28 | A close or a finish you press offers Undo | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0119](0119-a-leaving-claude-that-resumes-a-held-session-is-forced.md) | 2026-10-28 | A leaving claude that resumes a held session is forced too | [A resumed session is the session it was](../architecture/claude.md#a-resumed-session-is-the-session-it-was) |
| [0120](0120-a-needs-you-mark-shows-over-ready-not-over-work.md) | 2026-10-28 | A needs-you mark shows over ready, not over work | [Status cues](../architecture/status-cues.md#status-cues) |
| [0121](0121-a-quit-marks-nothing-finished.md) | 2026-10-28 | A quit before claude has gone marks nothing finished | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0122](0122-a-resume-or-clear-call-off-says-nothing.md) | 2026-10-28 | A resume or clear that calls a finish off says nothing of it | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0123](0123-a-worktree-badge-lists-only-checkouts-changed-in.md) | 2026-10-28 | A worktree badge lists only the checkouts a session changed files in | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0124](0124-claudes-idle-notice-is-ready-not-waiting.md) | 2026-10-28 | Claude's idle notice is ready, not waiting | [Status cues](../architecture/status-cues.md#status-cues) |
| [0125](0125-each-leave-item-does-one-thing.md) | 2026-10-28 | Stop session, Close tab and Finished each do one thing | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0126](0126-finished-is-one-press-and-waits-for-claude.md) | 2026-10-28 | Finished is one press, and the mark waits for claude to go | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0127](0127-going-on-working-calls-a-leave-off.md) | 2026-10-28 | A resume or clear during a leave calls the leave off | [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question) |
| [0128](0128-notices-of-something-finished-are-not-waiting.md) | 2026-10-28 | Notices of something finished are not waiting | [Status cues](../architecture/status-cues.md#status-cues) |
| [0129](0129-pick-holds-until-let-go.md) | 2026-10-28 | A picked checkout holds until it is let go | [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option) |
| [0130](0130-restored-tabs-are-not-paused.md) | 2026-10-28 | Tabs that were running no longer come back paused | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0131](0131-the-leave-button-can-be-finished.md) | 2026-10-28 | The tab's button can be Finished | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0132](0132-the-menu-header-lists-each-state.md) | 2026-10-28 | The menu's header lists each state a session is in | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0133](0133-the-needs-you-mark-is-settled-by-acting.md) | 2026-10-28 | The needs-you mark is settled by acting on the session | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0134](0134-the-tab-buttons-mark-follows-its-state.md) | 2026-10-28 | The tab button's mark follows its state | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0135](0135-a-changing-pr-marks-every-session-that-links-it.md) | 2026-10-29 | A PR changing in a way that needs you marks every session that links it | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0136](0136-a-commit-runs-only-the-checks-that-can-reach-it.md) | 2026-10-29 | A commit runs only the checks that can reach it | [Which checks a change needs](../architecture/build-and-checks.md#which-checks-a-change-needs) |
| [0137](0137-a-language-setting-for-times-and-dates.md) | 2026-10-29 | A language setting for times and dates | [The language](../architecture/window.md#the-language) |
| [0138](0138-a-session-keeps-every-needs-you-reason.md) | 2026-10-29 | A session keeps every reason it needs you for | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0139](0139-a-set-aside-day-comes-due-at-a-set-time.md) | 2026-10-29 | A set-aside day comes due at the time of day the settings give | [Status cues](../architecture/status-cues.md#status-cues) |
| [0140](0140-a-set-aside-session-has-a-mark-of-its-own.md) | 2026-10-29 | A set-aside session has a mark of its own, beside the dot | [Status cues](../architecture/status-cues.md#status-cues) |
| [0141](0141-a-tab-can-no-longer-be-paused.md) | 2026-10-29 | A tab can no longer be paused | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0142](0142-a-time-field-follows-the-language-from-the-next-launch.md) | 2026-10-29 | A time field follows the language from the next launch | [The language](../architecture/window.md#the-language) |
| [0143](0143-set-aside-and-needs-you-marks-are-kept-apart.md) | 2026-10-29 | The set-aside and needs-you marks are kept apart | [Status cues](../architecture/status-cues.md#status-cues) |
| [0144](0144-shared-calendar.md) | 2026-10-29 | The calendar is one module and stylesheet | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0145](0145-the-first-run-marks-only-sessions-set-aside-to-wait.md) | 2026-10-29 | The first PR run marks only the sessions set aside to wait | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0146](0146-the-set-aside-dialog-names-the-session.md) | 2026-10-29 | The set-aside dialog names the session in its title | [Status cues](../architecture/status-cues.md#status-cues) |
| [0147](0147-turning-pr-status-off-empties-what-was-seen.md) | 2026-10-29 | Turning PR status off empties what was seen | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0148](0148-context-change-runs-hidden-panels.md) | 2026-10-30 | A context change runs a hidden panel too | [A layout change keeps panels running](../architecture/panels.md#a-layout-change-keeps-panels-running) |
| [0149](0149-href-dropped-for-open-url.md) | 2026-10-30 | A list row's href was dropped for open-url | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0150](0150-link-hover-is-the-types.md) | 2026-10-30 | Hovering a list link shows only what the type says | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0151](0151-press-verbs.md) | 2026-10-30 | What a press does in a list is the type's, from a vocabulary of verbs | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0152](0152-sessions-snapshot-per-run.md) | 2026-11-02 | Every list run gets a snapshot of the sessions | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0153](0153-watch-sessions-waits-two-seconds.md) | 2026-11-02 | Watching the sessions waits 2 seconds after the last change | [Types from the config folder](../architecture/panels.md#types-from-the-config-folder) |
| [0154](0154-the-leave-button-key-names-the-leave.md) | 2026-11-03 | The leave button's setting is named for the leave | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0155](0155-the-leave-button-offers-close-finish-and-none.md) | 2026-11-03 | The leave button offers close, finish and none as choices | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0156](0156-a-sessions-menu-raises-no-toast-for-set-aside.md) | 2026-11-04 | A session's menu raises no toast for Set aside… | [Selecting several](../architecture/session-list.md#selecting-several) |
| [0157](0157-grouped-and-recent-are-the-sessions-panels-views.md) | 2026-11-04 | Grouped and Recent are the sessions panel's views | [Recent](../architecture/session-list.md#recent) |
| [0158](0158-list-order-catches-up-each-minute.md) | 2026-11-04 | The session list's order catches up once a minute | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0159](0159-pins-are-not-floated-in-recent.md) | 2026-11-04 | Pins are not floated in Recent | [Recent](../architecture/session-list.md#recent) |
| [0160](0160-set-aside-choices-come-in-the-order-of-their-moments.md) | 2026-11-04 | Set-aside choices come in the order of their moments | [Status cues](../architecture/status-cues.md#status-cues) |
| [0161](0161-settings-show-default-and-reset.md) | 2026-11-04 | Settings shows the default and a Reset under a changed setting | [The config folder](../architecture/config.md#the-config-folder) |
| [0162](0162-shipped-parts-are-overridden-by-id-field-by-field.md) | 2026-11-04 | What the app ships is overridden by id, field by field | [Status cues](../architecture/status-cues.md#status-cues) |
| [0163](0163-tab-bar-names-land-on-the-newest-row-in-recent.md) | 2026-11-04 | The tab bar's names land on the newest row in Recent | [Recent](../architecture/session-list.md#recent) |
| [0164](0164-the-reviews-days-are-fixed-in-its-definition.md) | 2026-11-04 | The review's days are fixed in its definition | [The review](../architecture/session-list.md#the-review) |
| [0165](0165-the-reviews-shared-conditions-hold-for-every-act.md) | 2026-11-04 | The review's shared conditions hold for every act | [The review](../architecture/session-list.md#the-review) |
| [0166](0166-a-close-offers-finished-and-set-aside.md) | 2026-11-05 | A close's toast also offers Finished and Set aside | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0167](0167-a-finished-session-is-never-opened.md) | 2026-11-05 | Every way the app opens a session refuses a finished one | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0168](0168-a-set-aside-list-with-a-bad-choice-is-not-used.md) | 2026-11-05 | A set-aside list with a choice the app cannot read is not used | [Status cues](../architecture/status-cues.md#status-cues) |
| [0169](0169-finished-sessions-are-kept-under-finished.md) | 2026-11-05 | Finished sessions are kept under `finished` | [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups) |
| [0170](0170-set-aside-for-several-leaves-their-notes.md) | 2026-11-05 | Setting several sessions aside leaves their notes as they are | [Selecting several](../architecture/session-list.md#selecting-several) |
| [0171](0171-set-aside-opens-one-dialog-that-only-marks.md) | 2026-11-05 | Set aside opens one dialog that only marks | [Status cues](../architecture/status-cues.md#status-cues) |
| [0172](0172-where-a-set-aside-session-stands-is-its-note.md) | 2026-11-05 | Where a set-aside session stands is its note | [Status cues](../architecture/status-cues.md#status-cues) |
| [0173](0173-a-dots-state-is-picked-by-one-strength-order.md) | 2026-11-06 | A dot's state is picked by one strength order | [Status cues](../architecture/status-cues.md#status-cues) |
| [0174](0174-a-dots-tooltip-lists-every-state-the-session-is-in.md) | 2026-11-06 | A dot's tooltip lists every state the session is in | [Status cues](../architecture/status-cues.md#status-cues) |
| [0175](0175-a-pr-change-marks-only-for-the-roles-its-type-lists.md) | 2026-11-06 | A PR change marks only where its type fires for your role | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0176](0176-a-pr-types-roles-are-changed-in-its-file.md) | 2026-11-06 | A PR type's roles are changed in its file | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0177](0177-a-roll-up-puts-what-asks-for-you-before-what-works.md) | 2026-11-06 | A roll-up puts what asks for you before what works | [Status cues](../architecture/status-cues.md#status-cues) |
| [0178](0178-a-second-request-for-changes-marks-again.md) | 2026-11-06 | A second request for changes marks again | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0179](0179-each-session-keeps-its-needs-you-history.md) | 2026-11-06 | Each session keeps the history of its needs-you reasons | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0180](0180-how-each-state-is-drawn-is-its-look-in-settings.md) | 2026-11-06 | How each state is drawn is its look, kept in settings.json | [Status cues](../architecture/status-cues.md#status-cues) |
| [0181](0181-look-is-a-class.md) | 2026-11-06 | A look reaches a status dot as a class | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0182](0182-marking-restored-sessions-is-the-types.md) | 2026-11-06 | Marking restored sessions is the needs-you type's, not the launch setting's | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0183](0183-needs-you-history-keeps-the-newest-20.md) | 2026-11-06 | The needs-you history keeps the newest 20 per session | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0184](0184-needs-you-reasons-have-types.md) | 2026-11-06 | Needs-you reasons have types, one per PR change | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0185](0185-needs-you-types-and-categories-ship-as-files.md) | 2026-11-06 | Needs-you reasons have types and categories, shipped as files | [Status cues](../architecture/status-cues.md#status-cues) |
| [0186](0186-new-commits-since-your-review-marks-once-per-review.md) | 2026-11-06 | New commits since your review marks once per review | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0187](0187-the-approvals-setting-only-raises-githubs-bar.md) | 2026-11-06 | The approvals setting only raises GitHub's bar | [Reading sessions](../architecture/sessions.md#reading-sessions) |
| [0188](0188-a-panel-row-has-one-kebab.md) | 2026-11-08 | A panel's row that names a session has one kebab | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0189](0189-a-press-to-see-the-list-brings-it-into-view.md) | 2026-11-08 | A press that asks to see the list brings it into view | [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it) |
| [0190](0190-an-answered-mcp-form-is-not-waiting.md) | 2026-11-08 | An answered MCP form is not waiting | [Status cues](../architecture/status-cues.md#status-cues) |
| [0191](0191-needs-you-changes-live-in-settings-json.md) | 2026-11-08 | Changes to the shipped needs-you types live in settings.json | [Status cues](../architecture/status-cues.md#status-cues) |
| [0192](0192-object-settings-written-entry-by-entry.md) | 2026-11-08 | An object setting is written entry by entry | [The config folder](../architecture/config.md#the-config-folder) |
| [0193](0193-only-what-differs-switch.md) | 2026-11-08 | What differs from the defaults is a switch, not a section | [The config folder](../architecture/config.md#the-config-folder) |
| [0194](0194-panel-full-screen.md) | 2026-11-08 | Any panel can fill the window | [Full screen](../architecture/panels.md#full-screen) |
| [0195](0195-ready-names-claude-stopped-at-its-prompt.md) | 2026-11-08 | Ready names claude stopped at its prompt with nothing running | [Status cues](../architecture/status-cues.md#status-cues) |
| [0196](0196-settings-in-sections.md) | 2026-11-08 | Settings is in sections | [The config folder](../architecture/config.md#the-config-folder) |
| [0197](0197-settings-on-off-is-a-switch.md) | 2026-11-08 | An on/off in Settings is a switch | [UI conventions](../architecture/ui-conventions.md#ui-conventions) |
| [0198](0198-settings-shows-needs-you-without-an-editing-screen.md) | 2026-11-08 | Settings shows needs-you without an editing screen yet | [Status cues](../architecture/status-cues.md#status-cues) |
| [0199](0199-show-in-list-leaves-full-screen.md) | 2026-11-08 | A press that asks to see the list brings the layout back from full screen | [Full screen](../architecture/panels.md#full-screen) |
| [0200](0200-the-apps-use-is-recorded-in-a-usage-log.md) | 2026-11-08 | The app's use is recorded in a usage log | [The usage record](../architecture/logs.md#the-usage-record) |
| [0201](0201-the-sidebar-has-no-live-strip.md) | 2026-11-08 | The sidebar has no live strip | [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process) |
| [0202](0202-the-switcher-counts-what-asks-for-you-elsewhere.md) | 2026-11-08 | The switcher counts what asks for you elsewhere | [Status cues](../architecture/status-cues.md#status-cues) |
| [0203](0203-a-file-past-its-size-is-split-or-says-why-not.md) | 2026-11-11 | A file past its size is split, or says why not | [Build](../architecture/build-and-checks.md#build) |
| [0204](0204-a-file-name-of-several-words-is-kebab-case.md) | 2026-11-11 | A file name of several words is kebab-case | [Build](../architecture/build-and-checks.md#build) |
| [0205](0205-fallow-gates-ci-for-unused-and-copied-code.md) | 2026-11-11 | Fallow gates CI for unused and copied code | [Build](../architecture/build-and-checks.md#build) |
