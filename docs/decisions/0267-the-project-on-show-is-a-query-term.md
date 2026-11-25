# The project on show is a query term

- **Date:** 2026-11-25
- **Area:** [Now](../architecture/session-list.md#now)

## Decision

`project:current` names the project on show where the query is asked: the switcher's in the session list and in a panel on This project, every project in a panel on All; `-project:current` is every other.
`current` is read as the scope, not as text in a project's name, and there is no `project:all`, since leaving `project:` out already means every project.
A section can say it stands only while one project is on show, for a section of what is elsewhere.

## Why

Now's Elsewhere section is the sessions outside the project on show; with the scope in the query, it is an ordinary section, and in All, where "current" is every project, it holds nothing.
The query cannot tell a section with nothing in it from one that has no meaning in this scope, so the one rule beside the query is when a section stands.

## Turned down

- A section option taking what the scope leaves out, a mechanism for one case where the query can say it.
- `project:@current`, safer against a clash with a project's name and harder to read and type.
- Drawing Elsewhere only while it has rows, which would never say "Nothing elsewhere."
