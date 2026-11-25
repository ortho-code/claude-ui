# Free words are matched each on its own

- **Date:** 2026-11-25
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

Each word of the query that is no field's term must be in one text of a session: its title, first prompt, folder, id, note, group's name, or a linked PR's reference or title, each a text of its own, without regard to capitals.
A quoted phrase must be whole in one of those texts.
The id is matched only from its start or its end, where a short form of it is cut from, so a whole id, its first part or its last part finds the session.

## Why

The search matched the whole text as one piece inside all of a session's texts joined together, so `fix login` missed a session titled "login page" with "fix it" as its first prompt, and a phrase could match across the join of two texts.
Matching each word in one text finds what the words describe and never matches across a join; quotes keep the exact phrase within reach.
Each kind of text a word searches is one entry in the fields' list, the PRs' entry giving two texts per PR, so a kind added later, such as a plugin's link, is one more entry.

## Turned down

- Only the title, first prompt and note: finding a session by its group's name or a PR's number would be lost.
- The whole text as one piece, as before: it keeps the join matching across two texts.
- The id anywhere, as the other texts: a short word such as `12` is in many ids, and with words matched on their own that noise reached any search with a number in it.
- The id only from its start: a tool that shortens an id to its end would not find the session.
- The id left out of free words, or only through an `id:` field: a pasted id would find nothing.

A word is matched as part of a text, as the search always was, so `here` also finds "Over there"; a phrase in quotes narrows it.
