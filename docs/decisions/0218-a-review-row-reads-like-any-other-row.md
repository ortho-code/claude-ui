# A review row reads like any other row

- **Date:** 2026-11-12
- **Area:** [The review](../architecture/session-list.md#the-review)

## Decision

A row in the review reads as it does in Recent: its time and model, led by its project in All and its group where it has one.
Its set's heading says why it is there, and its tooltip names its PRs with when they merged or closed ([0217](0217-a-session-rows-tooltip-says-everything-it-shows.md)).

## Why

The line that said why a row was there, its PR's title or how many PRs in each state and when they settled, did not fit the sidebar's width, so it was cut off before it said anything the heading had not.
With the row's tooltip naming each PR and its date, the same words then stood two or three times in the tooltip.
The review is one of the list's views, so its rows read as the list's rows do, and the view adds only which sessions it holds, its headings and what can be done with them.

## Turned down

- Keeping the line and leaving out of the tooltip a PR it already names: the line was still cut off on the row, and the tooltip lost the PR's repository.
- Keeping the line and leaving the PR's name out of the tooltip's copy of it: the tooltip would then say something other than the row, and still give the date twice.
