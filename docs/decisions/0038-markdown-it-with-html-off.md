# A reply is rendered by markdown-it with raw HTML off

- **Date:** 2026-09-29
- **Area:** [A reply is untrusted text](../architecture/history.md#a-reply-is-untrusted-text)

## Decision

A reply is rendered with `markdown-it`, raw HTML off.

## Turned down

- `marked`: it passes raw HTML through, so it would have needed a sanitizer beside it.
