# A commit runs only the checks that can reach it

- **Date:** 2026-10-29
- **Area:** [Which checks a change needs](../architecture/build-and-checks.md#which-checks-a-change-needs)

## Decision

A small change runs only the checks that can reach it, such as the window checks that find the label or class name it touches, and the whole of a suite only when its reach cannot be listed that way.

## Why

A change to one menu ran the whole window suite, over six hundred checks, to settle a handful.
