# A shell filed under a project stays in that project

- **Date:** 2026-10-16
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

For a shell filed under a project, "where you are working now" is within that project: the selection where it is in that project, else the project's root (`ownWhere`), with the `cwd` option applied either way.
Restart here in All with another project's tab on show, or none, no longer starts a shell in the folder of a project it is not filed under; a fixed `cwd` still starts it in that folder.
A shell's variables name its own project, whatever is selected when it starts, and the session on show only where that session is in that project (`runContext`): in All with one project's tab on show, a shell of another project started then is not that tab's.
