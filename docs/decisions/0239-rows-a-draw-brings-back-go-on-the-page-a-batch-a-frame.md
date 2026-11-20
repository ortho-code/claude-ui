# Rows a draw brings back go on the page a batch a frame

- **Date:** 2026-11-19
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

A draw of the session list puts at most 60 rows that are not on the page yet into it, top-down, and the rest 60 a frame after it; a newer draw drops what an older one left.

## Why

A key that empties the search brings hundreds of rows back at once, and at a thousand sessions on a slower machine (Chromium's CPU slowed four times) putting 603 of them on the page took a frame of 221 ms median and 322 at the 95th percentile, over a key's 200 ms; in batches, 127 and 155 ms (measured 2026-11-19).
The list starts at its top after a filter change, so the rows placed first are the ones in sight.

## Turned down

- Drawing only the rows in sight, a virtual list: it would replace the kept rows a press and the focus rely on, where batches change only when the rows below the fold arrive.
- Keeping a dropped row on the page but hidden: every count of rows on the page, the window's checks included, would count hidden ones.
- 120 rows a frame: 181 and 214 ms, still over at the 95th percentile.
- A debounce on the search field: a slow key would still be slow once typing paused.
