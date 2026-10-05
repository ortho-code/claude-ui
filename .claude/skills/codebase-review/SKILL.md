---
name: codebase-review
description: Review the codebase against a baseline commit — what got worse, what can improve, what got better — and write the findings up as work items, one per session; run only when asked.
disable-model-invocation: true
arguments: [baseline]
---

# Codebase review

Compare the code at HEAD with the code at a baseline commit, `$ARGUMENTS`, and report what got worse, what can be improved and what got better, as work items to take one per session.
The review changes nothing: it reads, and every fix it finds is a later change of its own, with its own plan and its own go.

## 1. The two ends, and where the report goes

- BASE is `$ARGUMENTS`.
  With none given, ask which commit to compare against, offering the last tag (`git describe --tags --abbrev=0`) and anything the user has called a baseline before; do not pick one yourself.
- HEAD is the commit checked out.
  Say so if the tree has uncommitted changes, since the review reads HEAD's files as they are on disk.
- The report is a research document, local to whoever runs the review.
  When `git check-ignore -q .plan/x` says `.plan/` is ignored, it goes to `.plan/research_codebase-review.md`, dated in its name if that file exists.
  Otherwise ask where it goes, and never write it into a tracked path without asking.

## 2. The scope

Read `CLAUDE.md`, `README.md` and `docs/architecture.md` first, as for any change.
Then gather what the report's § Scope and method needs: the commits between the two ends and what they did, and the size of `src/` and of the tests at both ends (`git ls-tree -r` and `git show <commit>:<path>` read BASE without checking it out).

## 3. The four reviews, in parallel

Start four agents in ONE message, so they run at once: one per review in [lenses.md](${CLAUDE_SKILL_DIR}/lenses.md), each handed its own section and the shared brief, with BASE and HEAD filled in.
They read only; none changes a file or starts the app.

## 4. Check what they found

A reviewer's reading is not yet a finding.
Read the cited lines for every HIGH and MEDIUM finding, and for any finding a work item would rest on: a claim that holds is VERIFIED; one that is wrong is dropped or corrected, and the report says which; the rest stay REVIEW.
Merge what two reviews found twice, and number the findings once, across every section.
Where behaviour is claimed and the code cannot settle it, the finding says so rather than guessing; it is reproduced, in a window check, when its fix starts.

## 5. The report

Write it in the shape of [report.md](${CLAUDE_SKILL_DIR}/report.md), one sentence per line.
Group the findings into work items in the order they should be taken, each sized and saying what it needs first, such as a decision round.

## 6. In chat

Give the verdict in a line, the number of findings per section, and the work item you would take first and why.
Then offer: start that work item in a new session, look further at something, or archive the report to `.plan/done/`.
Fix nothing until the user picks a work item.
