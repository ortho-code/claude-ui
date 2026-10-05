# The report's shape

One document, the working document for acting on the review: each work item it recommends gets a plan of its own, and the document says where each stands.
Findings are numbered once, across every section, so a work item and a later plan can name them by number.

```markdown
# Codebase review — research (written <date>)

## The ask (user, <date>)

<the user's words, quoted>

## Scope and method

- Baseline `<BASE>` (<date>, "<subject>"), compared against `<HEAD>` (<date>), <n> commits later.
- What those commits did, in a sentence or two.
- Size, before and after: lines and files in `src/`, the largest file, the number of tests and how long they take.
- Four parallel reviews, each read-only: architecture and coupling, the store and reactivity, tests and tooling, stylesheets, docs and conventions.
  A finding the main session checked against the code is VERIFIED; the rest are REVIEW, the reviewer's reading with `path:line`, not re-checked.
- Nothing was reproduced in the running app: a fix starts by reproducing its finding, in a window check where it is behaviour.
- Line numbers are as of `<HEAD>`.

## Verdict

Better, worse or mixed, in one line, then the few sentences that carry it.

## Got worse (introduced since the baseline)

1. **<title>.** <SEVERITY>, <VERIFIED or REVIEW>.
   <what happens, with path:line>; <where the baseline had it right, as BASE:path:line>.
   Fix: <one or two sentences>.

## To improve

## Smaller items

## What got better (keep it that way)

## Recommended work items, in order

One per session, each its own plan; each item above lands as its own commit.
- A. **<name>** (<finding numbers>). <SMALL, MEDIUM or LARGE>; <what it needs first, such as a decision round>.
```
