---
name: release
description: Cut a release — check the changelog, the docs and the text in the code against the code since the last tag, fix what is wrong, then bump the version, push, tag and follow the release to its published files, each external step after a go; run only when asked.
disable-model-invocation: true
arguments: [version]
---

# Release

Cut release `$ARGUMENTS` of claude-ui: first make what ships say what the code does, then cut it.
A release publishes the changelog's section as its notes and puts the README, the guide and every label in front of people, so each of them is checked against the code, not only the changelog.
Nothing leaves this machine without a go: the push, the tag and anything else written to GitHub each wait for one.

## 1. The range, the version and the facts

- BASE is the last tag (`git describe --tags --abbrev=0`), and HEAD is `main` as checked out.
  Stop and say so when the tree has changes, the branch is not `main`, or `git fetch` shows `main` behind or ahead of `origin/main` in a way nobody has explained.
- VERSION is `$ARGUMENTS`.
  With none given, propose one from what the range holds (a minor bump while anything is new before 1.0, a patch for fixes alone) and ask; never pick it alone.
- Gather the range: `git log --oneline BASE..HEAD`, the `## Unreleased` section and how many entries each heading holds.
- Build the RENAMED list: every word the app shows that the range renamed or took away, as `old → new` or `old → gone`, from the commit subjects, the Changed entries ("is called", "takes over from", "is gone", "no longer") and the labels changed in `git diff BASE HEAD -- src`.
- Gather the FACTS a doc or a comment may state wrongly: the repository's visibility (`gh repo view --json visibility`), the systems `release.yml` builds for and on which image, and the platforms the app runs on.

## 2. The checks, in parallel

Start the agents in ONE message, so they run at once: one per lens in [lenses.md](${CLAUDE_SKILL_DIR}/lenses.md), the changelog lens once per slice of about 40 entries, each handed its section and the shared brief with BASE, HEAD, VERSION, the RENAMED list and the FACTS filled in.
They read only; none changes a file, runs a suite, or starts the app.

While they run, check `UPGRADING.md` yourself: what a person on BASE must DO on upgrading, such as a setting renamed or removed without being read under its old name, data the app does not move by itself, or a system the build no longer installs on.
Say what you found either way; a version that needs nothing gets no section.

## 3. Check what they found

A finding is a claim until its evidence is read.
Read the cited code for every finding before acting on it; drop or correct one that is wrong, and say which.
A reason a finding supplies that its source does not give is narrowed to what the source says, never kept as found.
A finding that is not about the text but about the code's behaviour, a bug, is not fixed here: it is reported as a work item of its own.

## 4. Fix the text

Apply every verified finding as one change: the changelog, the docs, and the labels and comments the findings name.
Run the checks that change reaches, chosen as `CLAUDE.md` § Working in this repo says; `npm run test:text` holds every pointer, link and sentence rule, and the release test holds the version and the notes.
Show the diff's summary, what was dropped and why, and the commit message, and wait for a go before committing.

## 5. The cut

- Run the whole `npm test` and the whole `npm run test:renderer` on what will be released, one after the other, never side by side; the tag runs them again on CI, and a failure found there costs a release run.
- The release commit, `release VERSION`: `## VERSION — <today>` under `## Unreleased`, and `version` in `package.json` and in both places in `package-lock.json`.
  `test/text/release.test.ts` holds all three and runs `release.yml`'s own extraction on the section; run it, and show the commit and the number of lines the notes will have before committing.
- After a go, push `main`, and follow CI on that commit (`gh run watch`) until it passes; a failure stops the release and is reported with its log.
- After a go, tag `vVERSION` on that commit, lightweight like the tags before it, and push the tag.
  Follow the release run until `gh release view vVERSION` lists its files, a `.deb`, a `.dmg` and an `.AppImage`.
  The release run repeats CI before it builds, and its macOS build often waits in GitHub's queue for a runner: say so when it is queued, and call it a failure only when it fails.

## 6. What to watch

Close with what the range changed that no check reaches while sessions run, for the days after the release: starting, stopping and quitting sessions, the status hooks, behaviour measured only from another tool's source, and anything a commit in the range says was not seen live.
Each item says what to do and what to look for.
