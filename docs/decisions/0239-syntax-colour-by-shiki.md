# Syntax colour by Shiki, with the grammars picked

- **Date:** 2026-11-14
- **Area:** [The `diff` type](../architecture/panels.md#the-diff-type)

## Decision

Code is coloured by Shiki, on its JavaScript regex engine, with the grammars imported one by one: PHP, TypeScript, JavaScript, JSON, JSONC, JSON5, HTML, SCSS, CSS, Markdown, YAML, Shell, Twig, XML, SQL, Dockerfile, INI, TOML, Python, PowerShell, Go and Rust.
They load the grammars they embed too, through each other (Ruby, Java, C and C++, Lua and GraphQL among them), which colour code inside a file of a picked language, while a file in one of those languages stays plain: which files are coloured is the picked list.
Colours come from CSS variables of the app's own (`--syntax-token-*`), not from a theme.
The colouring hands back ranges over each line, so a surface lays its own marks over them, such as a diff's changed words.
A file in a language without a grammar here is plain text.

## Why

Shiki uses the grammars VS Code uses, so code reads as it does in an editor, and it reads a whole text as one, so a line inside a block comment colours as a comment.
Its tokens come with their place in the text, which is what lets a changed word be marked over its colour without cutting into it.
The window is one bundle, so every grammar imported is in it: the list was taken from the files the repositories on the machine it was built on hold, Go and Rust added, rather than every grammar Shiki has.
They grow the window's bundle from about 0.9 MB to about 3.2 MB.
The JavaScript engine needs no WASM, which the bundle would otherwise have to carry and load.

## Turned down

- Prism, smaller and synchronous, whose nested stream of tokens can be flattened into ranges: its grammars are its own, further from what an editor shows.
- highlight.js: it hands back HTML, so a changed word's mark has to cut into its tags.
- Every grammar Shiki has: tens of megabytes in a bundle loaded whole.
- Tree-sitter's highlight queries: a parser the app does not have, and colour only for languages with a grammar shipped for it.
