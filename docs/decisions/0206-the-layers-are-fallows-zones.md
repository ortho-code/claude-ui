# The layers are fallow's zones

- **Date:** 2026-11-11
- **Area:** [Processes](../architecture/processes.md#processes)

## Decision

Which folder of `src/` may import which is declared once, as fallow's boundaries in `.fallowrc.jsonc`: zones of files, each with the zones it may import, checked by `npm run fallow` and in CI.
Every source file is in a zone: a new folder in the renderer falls to the services, the layer that may import least, and one beside the processes fails until it is given a zone.
`test/unit/boundaries.test.ts` crosses every line in a project of empty modules, checked with the repo's own zones.

## Why

The same lines were held by ESLint's `no-restricted-imports`, in eight blocks of path patterns; ESLint takes a rule's settings from the last block that matches a file, so each block repeated the process rule, and a folder no block named was free inside its process.
A list of zones says the layers in one place, as allowed imports rather than forbidden ones, and fallow resolves each import to its file, so a roundabout spelling of a path no longer slips past a pattern.
Fallow already ran in CI, so this adds no dependency and about half a second.

## Turned down

- dependency-cruiser: it holds the same lines as named forbid rules, but brings 45 packages and needs the TypeScript 6 API, as typescript-eslint does, for what fallow already does.
- Keeping ESLint, with a test that every folder is named in a block: it would show a crossing while typing, which fallow does not, but keep the eight blocks and the order trap.
