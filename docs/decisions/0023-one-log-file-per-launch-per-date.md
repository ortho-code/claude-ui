# One log file per launch per date

- **Date:** 2026-09-28
- **Area:** [The log](../architecture/logs.md#the-log)

## Decision

The log is one file per launch per date, named by the local moment it started.

## Why

A crash in the morning and a clean launch in the afternoon would otherwise share a file, and a file can only be kept whole.

## Turned down

- One shared file per date: a crash in the morning and a clean launch in the afternoon would share it, and a file can only be kept whole.
