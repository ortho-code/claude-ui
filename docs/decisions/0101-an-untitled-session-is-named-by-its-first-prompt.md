# A session Claude has not titled is named by its first prompt

- **Date:** 2026-10-22
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A session's name is its custom title, else the title Claude generated, else its first prompt, else `New: <folder>` after the folder it runs in.
The app stores no name of its own, and offers none to claude.

## Why

Claude generates a title from the first prompt that is neither a slash command nor its own plumbing, so a session started with a skill such as `/implement` goes by its command a long while, its title coming late, from a later prompt, or never; and its automatic title generator runs only while the session has no title of any kind, so never once it has a custom title (none of 228 named sessions on one machine got one later).

## Turned down

- Naming a session only by Claude, with `New:` before a prompt and `Untitled:` after: 63 of the 326 unfinished sessions of one project there had no title, 11 of them real conversations that would then differ only by their dates.
- The app sending `/rename`, which makes Claude generate a name: it would type into a terminal where you may be halfway through a prompt.
