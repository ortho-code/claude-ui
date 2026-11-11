# Set aside opens one dialog that only marks

- **Date:** 2026-11-05
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)
- **Partly replaced** by [0212](0212-setting-a-running-session-aside-stops-it.md) on 2026-11-11: Set aside no longer only marks, since a claude running in the tab is stopped as `setAsideRunning` says; the one dialog still holds.

## Decision

Set aside… in the session's menu opens one dialog, for a session with a tab or without, running or not.
It only marks, leaving the tab as it is.

## Why

Stop, Close and Finished each do one thing too.

## Turned down

- A submenu of the choices with the dialog at its foot: two ways to one act, the quick one skipping where it stands, for one press saved.
