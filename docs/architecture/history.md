# In-session history

## In-session history

Claude's fullscreen renderer (`"tui": "fullscreen"`) draws on the terminal's alternate screen and scrolls itself, so the terminal keeps no scrollback of the conversation, and claude publishes neither where it is scrolled nor how tall the conversation is.
So nothing here can follow claude's own scrolling, and marking lines in the terminal's buffer — xterm markers placed as each request is sent, the first design — has no line to hold on to.
The app draws a history of its own instead, from the session's transcript, which holds every request and reply, outlives every restart, and keeps what a compaction took out of claude's own view.
The code is in `src/main/transcript.ts` (reading) and `src/renderer/panels/types/claude/history/` (the view, the bar and the loupe), and what hands the pane to it and back — the ways in, the keys, and the sentence it stands under for a cold tab — is the pane's, `src/renderer/panels/types/claude/pane.ts`.

### Opening it, and getting out

**The history opens only on purpose**: from the bar beside the terminal (a press, or the loupe), the arrow at the bar's foot, or Ctrl+Shift+↑ for your last request — every way in goes through one function, `openHistory`.
The wheel over a running claude stays claude's, and scrolls claude's own view.
Inside, Ctrl+Shift+↑ and Ctrl+Shift+↓ step to the previous and next request, and ↓ past the last one goes back to live; previous and next measure from the request line, which is where a jump puts the view.
Both are caught on the window in the capture phase, before xterm, which would otherwise send them to claude; app shortcuts take Ctrl+Shift because a bare Ctrl+letter belongs to the terminal.

**It is a drawer from the bar**: it slides in from the right edge, beside the bar it was opened from, over about two-thirds of the pane — never narrower than 560px, and the whole pane when the pane is narrower than that.
Claude stays in view on the left, live and at its real size under a scrim that dims it; the terminal is never resized for it, so claude never redraws, and a click on the dimmed claude is the way back.
The scrim takes that click rather than passing it to claude, as a drawer's does.
**Getting out is otherwise one labelled control**, "Back to live", in the history's head and always in view, with Esc as its key; the focus goes back to the terminal.
The first versions covered the whole pane, and "how do I get back?" was the question they left.
The next took the upper two-thirds and left the lower third to claude, where a click went back and reached claude as well; in use it read as a split panel rather than something laid over claude, so it was replaced by the drawer.

That is the second version, and the first is worth knowing because it was tried and reversed after use.
It took the wheel: xterm asks `attachCustomWheelEventHandler` before it sends a mouse report or turns the wheel into arrow keys, so answering false keeps the wheel from claude, and a wheel up over the alternate screen handed the pane to the history, scrolling on past its end handing it back.
It read well as "scrollback that remembers everything", but in use a scroll that turned into another mode was a surprise, claude's own wheel scrolling was gone, and the point of the app is to work in a session, not to read it.
The exit was a floating pill at the foot and End, and was not found.

The history is ONE view, for the active tab, rebuilt when the tab changes.
**Each tab keeps its own state**: leaving a tab with its history open remembers where — the request at the top and how far past it, or the end, where it keeps following what claude adds — and coming back reopens it there once it has been read again; a tab left live comes back live.
Coming back shows the tab live until that read is done, since there is nothing to draw before it.
The memory lasts as long as the tab and the run, not across a restart, and it is kept per session, so a `/clear`, which starts a new session in the same tab, closes the history.
Switching tabs always closed the history at first, which lost your place in it whenever you looked at another tab.
It is kept laid out beneath the live terminal — hidden by visibility, never display — because the bar beside it places its marks from the history's measured heights, and a node with `display: none` measures as nothing.
Its width is the drawer's over a live tab and the whole pane's on a cold one, so it re-measures the marks whenever its own size changes, since every width rewraps the replies.

**It is drawn in slices**, with the window free between them, since it is drawn on every switch to a tab, open or not.
Drawn at once, the longest session here (761 requests) held the window for 1–2 s on each switch, and a profile put most of that on the browser laying out the whole new list in one go, not on the app's code; `content-visibility: auto` on each exchange did not cut it, and broke jumps, since positions were then measured against placeholder heights.
First the newest exchanges, up to 12 ms of work, which is where the history opens and what Ctrl+Shift+↑ goes to; then the rest from the oldest up, a slice at a time, each put in just above that newest part, so each one lays out only itself and what sits below it.
Drawn newest first all the way down, every slice went in above everything already drawn and the browser laid all of that out again: twice the work in total, in slices that grew to 300 ms.
Now no slice holds the window much past 90 ms, and the longest session is whole after about 2 s; the bar measures at most every 250 ms meanwhile, since it measures the whole list each time.
Coming back to a tab left open further back than the newest slice reopens it once its slice is in.

**A tab with no claude behind it** that is on screen, the one restored at launch or one refused a start, shows the pane's sentence — "“…” isn't running." — with a Resume button, which starts it as a click on its tab does, and a Show history button.
The history then stands under the same sentence, one function for both, with Resume and Close; there is no "Back to live", since there is no live view.
With the folder gone, Resume is unavailable with the reason, and Show history still works, since reading a session whose folder has gone is exactly when you want it.
Showing the history there by itself, at launch, was tried and reversed: it was not clear what had happened or why it was shown.
The bar is out of sight on that sentence, and while a tab is starting, and comes with Show history, since until then there is nothing for it to scroll; it was there at first.
It is hidden by visibility, keeping its column, so the terminal's width does not change when the tab starts and claude is not redrawn.
A stopped tab still drops you to the empty screen; reopening it resumes claude, and the history is then on the bar.

### What counts as a request

A typed prompt, one with a pasted image, one sent while a tool ran, one queued while claude was working — a `queued_command` attachment, which is not a user record at all — a slash command claude answered, and a command claude ran itself, such as `/model` or `/compact`.
Not a request: tool results, meta records (a skill's expanded body, a message from another session, a subagent's hand-back), compaction summaries, interruptions, and Claude Code's own tag-wrapped plumbing (a local command's output, a reminder, a task notification, `!` bash mode), whether it comes as a user record or queued while claude worked — the queued ones were missed at first, and drew 253 task notifications as requests.
A subagent's hand-back is queued too, marked meta on its attachment and wrapped in a tag with an attribute (`<agent-message from="…">`), which the plumbing rule at first did not take for a tag: 149 of them, in 41 of 445 transcripts, showed as requests until a queued record was held to its meta mark as a user record is, and a tag to its name whatever attributes follow.
Its report is drawn in the reply instead, where it came back (§ What it looks like).
The rule was taken from a scan of 312 transcripts, and the numbers below are from them.

**A command claude runs itself counts at once; one sent to the model, once claude answers it.**
A command claude runs itself, such as `/model`, `/compact`, `/clear` or `/rename`, is something you did, though nothing answers it, so it stands with no reply under it.
Claude writes it with the command's name first ([§ Reading sessions](sessions.md#reading-sessions)), as a user record or, for some, as a `local_command` system record: 164 and 135 on one machine (2026-10-22), most of the second `/rename`.
Where Claude wrote the line as typed text just before, as it does `/compact` before compacting (37 of 74 there), the command is that same request and is not shown twice.
Claude's reply goes on under the request it is answering, so a `/rename` or a `/login` run in the middle of a turn takes none of it; a command claude ran itself takes only Claude Code's own `<synthetic>` line, such as the one saying no response was requested.
A reply that goes on under a request before the last sends that request to the window again, as a rewind does (`changedFrom`), since a read otherwise sends again only the last one.
A command sent to the model, such as `/review` or `/learn`, waits for an assistant record, across reads of a file claude is still writing, and is dropped if the user sends something else first.
Waiting for an answer was at first how `/model` and `/clear` were told from `/review`, since the command line cannot tell them apart, and it hid them; it let one through whenever any assistant record followed it, about a dozen on that machine, a few of them a second copy of a typed `/compact`, and hid some 250, until they were all shown (2026-10-22).
Leaving slash commands out altogether was the first rule, and it left a session that was one `/review` doing all the work with an empty history.

**A transcript is a tree, and it keeps abandoned attempts.**
Stopping claude and sending again, or editing and resending, leaves the first attempt in the file beside the second, both hanging off the same parent record.
The history shows it, dimmed and marked "sent again", rather than hiding it, so a stopped attempt's partial reply and a pin on it stay; 268 of them in a later scan, of 353 transcripts, which the numbers for rewinds and records written twice come from too.
**Claude's rewind leaves the requests it went back past** in the file too: a later request hangs off the same parent as one further back, and every request in between follows on from that one.
All of them are marked "rewound" and dimmed the same way, since claude's conversation no longer has any of them; 59 requests in 2 sessions, in one of which the request after the rewind says "I rewinded, but one too many".
A same-parent request further back that the ones since do not all follow on from is left unmarked, rather than guessed at: there were 304 such at first, and all but those 2 rewinds turned out to be records Claude Code writes twice (see Reading a transcript).

The session list's first prompt is read by the same rule as a request, except for slash commands: a command claude ran itself is a request in the history but no prompt to name a session by, since it says nothing of what the session is for, and a command sent to the model is a first prompt at once, where the history waits for its answer.

### Reading a transcript

The first read of a session is whole, and every later one reads on from a byte offset; the largest transcript here, 50 MB, reads whole in about 0.3 s and reads on in under a millisecond.
The whole read goes in 4 MB pieces with the main process handed back between them, so it holds the main process, and every terminal's output with it, for at most about 40 ms at a time; measured, so no worker is needed.
The partial last line is kept as bytes rather than text, because a read can end inside a multi-byte character; a newline byte never occurs inside one, so cutting at the last newline leaves whole characters on both sides.
A file shorter than what was already read is read again from the start as a new generation, which tells the window that nothing it holds is still good.
Only the last exchange ever changes — claude's reply to it grows — so each read hands back the caller's last exchange again with everything after it, and the window redraws only those.
A rewind is the one exception: it marks requests the window already holds, so that read hands them back again from the first it went back past.
The window reads on `sessions:changed` and on the active session's status events.

**Claude Code writes records twice.**
After a compaction it writes much of the conversation into the file a second time under the same uuids, with only bookkeeping changed (git branch, version, prompt id; the message itself in 3 of 6,490 copies, in 8 transcripts).
Folded as they came, those copies drew 302 requests, and 763 of claude's messages, twice, and a pin on one lit both.
The reader folds each uuid once and keeps the first copy.

### What it looks like

**Like claude's own view of the session**, because the history is a look back at that same view: the terminal's background, face and text colour — one token, `--terminal-fg`, which xterm reads back as well — and its tight line height; your request as claude echoes it, `> …` on a tinted band, with its number, time and marks at the band's end; and each of claude's messages, and each tool call, behind the dot claude marks them with.
**A step smaller than the terminal**, 12px against 13px, on purpose: the browser draws the same face heavier than xterm's character grid does, and at the terminal's own size the history read louder than claude beside it.
The app's own face for claude's prose was tried beside it headless and not taken: the history is to read as claude's view.
The `>` stands in the same gutter as claude's dots, centred where they are, so a request's text starts where a message's does, and its later lines start under its first line's text, as claude indents them.
So the reader keeps a reply as `parts`, in the order claude wrote them: every message its own part, every tool call a one-line part where it came.
The first version joined the text into one reply and folded the tools to a count, which made consecutive messages one block and put every tool call in the wrong place.
A tool call is drawn as claude draws one, a green dot, the tool's name in bold and what it acted on in grey; drawn like a message, with the same dot and ink, the two were too much alike to tell apart.
**A run of tool calls between two of claude's messages is folded to one line**, as claude folds them — "Ran 4 shell commands, read 1 file", with a chevron — which opens into the calls; it stays open or closed while claude's reply grows.
That is a fold in place, where the first version's count was one for the whole reply.
A lone call stays its own line, since its line says more than a count of one.
An edit (Edit, Write, MultiEdit, NotebookEdit) folds with the rest, where claude shows each apart but for its own memory and scratch files, and the line counts the files changed, so a change still shows without a line each, and which files once the run is opened.
Edits first kept a line each and ended a run, and those lines were a third of the history: across 506 transcripts of 10,586 requests, 34,946 of the 103,569 lines drawn, and folding them takes it to 68,854.
The line uses claude's words where they are known ("ran N shell commands", "read N files") and plain ones otherwise ("changed N files").
A phrase about files counts each file once, told apart by what the call acted on as its line shows it, since in half the runs with an edit (5,400 of 10,925) a file is changed more than once; a shell command run twice still counts twice.
That line is cut at 120 characters, so two longer paths alike up to the cut count as one file.
Not taken: folding a lone call too, which saves no line and hides what it acted on; a message no longer ending a run, which would fold the tool calls from either side of a sentence into one line, out of the order claude wrote them; and counting edits by call ("made N edits"), which does not say how many files.
**A subagent's report is folded to one line too**, "claim-checker reported", where it came back in the reply, and it ends a run as a message does; it opens into the report as markdown, drawn by the same rules as claude's messages.
Where it came back is not always beside the Agent call that started it: of the 151 reports on the machine this was written on, 57 follow their call, 42 follow another report, from agents started side by side, 50 follow some other tool call claude made meanwhile, and 2 open a reply; a few came back after a new request, and sit in that request's reply.
Folded, since a report runs to several kilobytes (0.5 to 21 KB as drawn, about 5 KB in the middle) and open it would outweigh claude's own reply.
The report is cut from the frame Claude Code hands it back in, a preface ending in "The report follows:" and then the report with every line indented two spaces, the same in all 151; a report without that line is shown whole rather than cut where the frame is guessed to end.
A note Claude Code puts on a report itself, that it "matched instruction-shaped pattern(s)", stays, since it is about that report, and so do the tags it escapes as `<\`.
The agent's name is in every one of those records written by claude 2.1.286 or later, and in none written before; a report without it reads "A subagent reported", rather than having its name traced back through the Agent call's result.
A report has no star: pinning one waits for a list of pins across sessions, which is what would make a pinned report worth having.
The dot is drawn in CSS rather than claude's `⏺` glyph, since the app draws no mark from a font.
**A line break in claude's text, or in a subagent's report, is a line break**, as it is in the request above it, which keeps its own with `white-space: pre-wrap`.
CommonMark's default joins the lines of a paragraph, which suits prose wrapped at a fixed width and ran a reply written a sentence to a line into one block, so the markdown is rendered with `breaks: true`: a line break inside a paragraph, a list item or a quote becomes a `<br>`, and `#` headings, code blocks and tables come out as they did.
A `<br>` in the markup rather than `white-space: pre-line` on the message, since a stylesheet cannot tell a line break in the text from the newlines markdown-it writes between tags, which `pre-line` turns into blank lines.
Code is told apart by colour and by place: inline in the accent, a block on a panel of its own, a step lighter than the history and scrolled sideways rather than wrapped.
A block had a rule down its side at first, which is how a quote is drawn, and a block read as a quote; a quote keeps the rule, in the accent's muted tint, with its words in italics.
The history has no scrollbar of its own: the bar beside it is its scrollbar.

### Pins

A request and each of claude's messages can be pinned.
Each star stands in the gutter, in place of the mark there: the request's where its `>` is, a message's where claude's dot is.
Both show on hover and always once pinned, and what is pinned has an accent line in the margin beside it, as its mark on the bar is in the accent.
A pinned request had an accent edge inside its band at first, which the star now stands on.
On the bar a pinned reply is in the accent as a pinned request is, and in the loupe it carries the star.
What is shown is a labelled switch in the head, `All 54 · Pinned 3`, in the filters' pill: an unlabelled star did not say it was a filter; the count is of pins, and Pinned shows every exchange holding one.

A request is pinned by its record's uuid, and a message by its assistant record's uuid and its place among that record's messages; a fork copies uuids, so a pin shows in both siblings.
Each pin keeps its kind, the session it was made in, the opening of the text and its time, so a list of every pin can be drawn from `meta.json` alone.
They are stored as `historyPins`; request pins made before messages could be pinned were stored as `requestPins`, which is still read, and written back as `historyPins` the next time `meta.json` is saved.
Deleting a session leaves its pins: a sibling may still carry the request, and telling which pins nothing opens any more takes every transcript read, which is a job for a list of every pin rather than for a delete.

### A reply is untrusted text

Claude quotes web pages, files and tool output, so a reply is rendered with raw HTML off (`markdown-it`, `html: false`): markup in it is shown as text.
Its link check refuses `javascript:`, `vbscript:`, `file:` and `data:` links, bare URLs included, and images are not rendered, since the CSP would refuse a remote one and leave a broken icon.
Every link click, middle-click included, goes to `shell:openExternal`, and main refuses any navigation of the window besides (see Processes); the CSP is the last layer.
`marked` was the alternative, and passes raw HTML through, so it would have needed a sanitizer beside it.

### The bar and the loupe

The bar at the terminal area's edge is the history's scrollbar, there while claude is live or its history is open: a tick across it per request, a thin bar down its middle per reply — a shape apart, not only a shade — pins in the accent, a request sent again dimmer, the last request in white, and, while the history is open, a band for where you are in it, with the marks inside it lit as the loupe's entry is, a step dimmer so that one stays the brightest.
The band alone, a faint wash on a 14px bar, was not seen.
There is no band while live: the wheel scrolls claude's own view there, and where claude is scrolled is not something the app can know, so any band would be a guess.
It is a column of its own rather than an overlay, so it never covers claude's text; the terminal is that much narrower, and the fit hands the pty the new width.
**Pointed at, it is drawn wider**, 24px against the column's 14, so it is easier to stay on; it stays wide while the loupe is open or a press is held.
The extra width lies over the terminal's edge, as the loupe does, and the column itself never changes: a wider column on hover would narrow the terminal and make claude redraw every time.
**A request is a target of about 9px** around its tick — 4px above, 5px below — where it was about 5 and hard to hit, and its tick is drawn a pixel taller; its reply has the rest, down to the next request, and two requests closer than that split the room between them.

**Pressing on it is a scrollbar's**: the view goes to that point at once, opening the history if it is closed, and follows the pointer until the button is let go; pressed on the band, it holds the band where it was taken instead of jumping, as a thumb.
It follows the pointer anywhere on the window until the button is let go, since a hand's drag drifts sideways off a 14px bar, and from any pointer, since WSLg sends a held button's moves as another one (see Traps).
It is the rough way to a place, and the loupe the exact one: the loupe hides while the button is down and is back when you let go, and a click on its row, or Enter, opens that entry.
The first version started a drag only after 4px of travel and took a press that did not move as a click on the loupe's entry; in the user's words, what was wanted is "press the mouse on a point in the sidebar, then the view should already go there".
Neither the bar nor the loupe takes the focus, so the terminal or the history keeps the keys: a click on either used to leave the focus nowhere, and Esc and the step keys with it.

Hovering it opens the loupe, the entries around the pointer in words, and the wheel steps it one entry per notch, a trackpad one per 30px.
That is the answer to the hard requirement, that one exact request or reply be reachable in a session of hundreds: at 821 requests the bar has under a pixel per entry, so the pointer alone picks roughly.
A fisheye on the bar itself was tried in a mock and rejected — it spreads the entries under the pointer, but the pointer still moves through them too fast to stop on one.
The loupe stays on an entry once the wheel has stepped until the pointer really moves, and keeps it when the pointer crosses into the loupe, so reaching for it does not undo the choice.
It takes the arrows, Enter and Esc only while the pointer is inside it or the history has the pane: with the pointer merely resting on the bar, the live terminal has the focus, and a prompt typed with the pointer parked there must still reach claude.

Rejected from the same mock: a popover from the tab bar (no scrollbar), a panel (a layout-file entry today), typing claude's own transcript-mode keys into the pty to move claude's view (it lands wrong when claude is in another state, and nothing says so), and xterm's own overview ruler (only on claude's default renderer, and its marks go with the process).
