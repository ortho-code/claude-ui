# The four reviews

Each runs as an agent of its own, read-only, in parallel with the other three.
Hand each one the lines under its heading, with BASE and HEAD filled in, and the shared brief below them.

## Architecture and coupling

How the code is divided and how its parts reach each other, now against BASE.
Module boundaries and what holds them (the linter's rules, the import-cycle test); calls that cross surfaces through more hops than they need; a part that works only because of the order modules load in; a module doing several jobs; duplication, read against `CLAUDE.md`'s rule of one implementation and one behaviour per question.

## The store and reactivity

How state is kept and who is told when it changes, now against BASE.
Slices and their watchers; a repaint reading what it was not told about; identity against equality; a read from main landing after something newer; a watcher's failure reaching the writer; work repeated per event that could be done once; each watcher's private copy of what the store already knows.

## Tests and tooling

What holds the code, now against BASE.
Unit tests and the window's checks, and what has none; how faithful the checks' stand-in for main is, and the calls it does not model; flakes and fixed sleeps; CI and the release workflow against what runs locally; the lint boundaries' holes; time zones and other state a check leans on without fixing.

## Stylesheets, docs and conventions

What the code says about itself, now against BASE.
CSS kept in step by comments rather than shared; values that should be tokens; a rule or a stylesheet that works only by load order; comments that no longer say what the code does; every identifier and path `README.md` and `docs/` name, and whether it exists; the conventions in `CLAUDE.md` and `docs/architecture.md` § UI conventions, read now rather than remembered.

## The shared brief, for each of the four

- Read `CLAUDE.md`, `README.md` and `docs/architecture.md` first.
  Then compare BASE with HEAD: `git log --oneline BASE..HEAD`, `git diff --stat BASE HEAD`, then the files themselves.
- Read only: change nothing, run nothing that writes, and never start the app.
- Report every finding as: a one-line title; GOT WORSE (introduced since BASE, with where BASE had it right, as `BASE:path:line`) or TO IMPROVE (present at BASE too, or new and not yet a regression); a severity, HIGH, MEDIUM or LOW; `path:line` at HEAD for each claim; what a person would see, as a scenario where it is behaviour; and a fix in one or two sentences.
- Say how sure you are.
  A claim read from the code is fine; a guess is marked UNSURE, and a claim about runtime behaviour that the code alone cannot settle says so.
- Also report what got better, with `path:line`, so the next change keeps it.
