# The checks

Each runs as an agent of its own, read-only, in parallel with the others.
Hand each one the lines under its heading, with BASE, HEAD, VERSION, the RENAMED list and the FACTS filled in, and the shared brief below them.

## The changelog, one slice each

The entries of `## Unreleased` in the slice it is handed, each against the code at HEAD and the code at BASE.
- An entry that is no longer true: a name, a setting, a label or a value it quotes that the code does not have, or a word from the RENAMED list, such as an entry still describing a feature the range took away.
- An entry about something BASE did not have, under Changed or Fixed: it describes a step on the way, and belongs folded into that feature's Added entry in its final form, or dropped, since a bug in what was never released is no fix to a person on BASE.
- A heading that does not fit: Added for what is new to a person on BASE, Changed for what they had, Fixed for a bug they could meet.
- Two entries about one change, one a later entry reversed, and a continuation line left behind under another entry when its own entry was removed.
- The rules in `CLAUDE.md` § Conventions for the changelog: one bullet per entry, one sentence per line, what changed for the reader, no internal change.
A slice that holds Added also says which Changed or Fixed entries belong folded into its entries.

## What people read first: README, the guide and UPGRADING

`README.md`, `docs/guide/` except its reference pages, `CONTRIBUTING.md` and `UPGRADING.md`, each statement against the code and the FACTS.
- A claim the code or the FACTS contradict, such as where builds are found or what a setting does.
- A promise of what is not built, such as a view or an option said to be coming.
- A feature the range added that the README's short list or the guide's area does not mention, or one the range removed that they still describe.
- A word from the RENAMED list, and a description written for one machine where the app runs on several.
- Every link resolves, which `test/text/links.test.ts` already holds; this check reads whether it leads to the right place.

## The contracts: what scripts and settings are written against

`docs/panel-types.md`, `docs/guide/layout.md` and `docs/guide/settings.md`, every field, option, verb, variable, default and limit against the code that reads it.
A wrong one breaks a script or a settings file someone wrote against it, so read the validator, not only the happy path.
- A value described for only one of its cases, such as a variable whose source changes with what is selected.
- A required field not marked so.
- A rule that refuses where the doc says it is ignored, which turns a harmless field into a broken list.
- What the code accepts or hands a script that the doc leaves out, and an example that would not validate.

## How it is built: the architecture, the decisions and the principles

`docs/architecture/`, `docs/principles.md` and the index of `docs/decisions/`.
- A statement of what the app does that the code no longer does, and a reason that no longer holds because what it names was changed or removed.
- One machine's setup written as the app's, such as a single platform described as the one it targets.
- A passage that records a choice inline rather than linking its decision in `docs/decisions/`, and a decision's area link that leads nowhere.
- A word from the RENAMED list.
A decision file records what held when it was taken, so its reasons stay as they were; only its area link is checked.

## The text in the code

What the app shows and what its comments state, across `src/`, `index.html`, `.github/` and `electron-builder.yml`.
- A label, tooltip, dialog line or toast with a word from the RENAMED list, or promising what is not built.
- A comment stating a fact about the repository, the platforms or another tool, such as the repository's visibility or what a workflow costs, that the FACTS or the tool's own source contradict.
- A comment naming a file, a function or a heading that is gone; `test/text/pointers.test.ts` already holds every pointer to a doc's heading, and nothing holds a bare path.

## The shared brief, for each check

- Read `CLAUDE.md`, `README.md` and `docs/architecture/README.md` first, then the files the check is about, then the code each statement rests on.
- Compare with BASE where it decides a finding: `git show BASE:<path>`, `git grep <term> BASE`, `git log --oneline BASE..HEAD -S'<text>'`.
- Read only: change nothing, run no suite, and never start the app.
- Report each finding as: the file and line, or the entry's first words and line; what is wrong; the evidence, as `path:line` or the command and its output; and the replacement text in the file's own style, one sentence per line, or "drop" with why.
- Mark each one CERTAIN or UNSURE, and never supply a reason, an alternative or a date the code and the history do not give.
- End with what was checked and found clean, so a gap in the check shows.
