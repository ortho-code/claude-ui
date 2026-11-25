# Now's sections say whose turn it is

- **Date:** 2026-11-25
- **Area:** [Now](../architecture/session-list.md#now)

## Decision

Now has four sections by whose turn it is: Needs you, what asks for you now; Running, what runs and does not ask; Elsewhere, in This project only, other projects' sessions that ask or run; and Not now, what is set aside or has reasons that do not ask for you now.
Its sections, their order, the order within each and what each row says match the list panel it replaces, row for row.

## Why

Now replaces a list panel the app's user built and used every day, and the first requirement was that it shows what that panel showed; a section per needs-you category, as first designed, would change what is looked at daily for a layout nobody had asked for.
A session asking for you is one decision whatever the reason, and a reason already read is not your turn, so whose turn it is sorts better than why.

## Turned down

- A section per needs-you category (Your turn, Back to work, Ready to merge, Look again, Reminders, Finish up), with a read row staying muted in its category: a grouping by category can come as a view's group-by instead.
- Leaving Elsewhere out now the project switcher's badge counts what asks for you in other projects: the panel it replaces had it, and it names which sessions.
