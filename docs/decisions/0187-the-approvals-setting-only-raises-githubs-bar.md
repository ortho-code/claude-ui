# The approvals setting only raises GitHub's bar

- **Date:** 2026-11-06
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

Approved is GitHub's review decision and, where `approvals` in the settings names the PR's repository, that many approvals counted from the reviews (`isApproved`): the number only raises GitHub's bar.
The repository's own number is not asked of GitHub.

## Why

GitHub enforces its own number, and a PR it does not call approved would not merge.

## Turned down

- Asking GitHub for the repository's own number: its branch protection answered a login without admin rights 404 (asked 2026-11-06), and the team's number may be a habit GitHub does not hold, as one approval enforced and two agreed was.
