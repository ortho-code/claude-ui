/** The characters a shell reads as something other than part of a word, each to go behind a backslash. */
const SHELL_SPECIAL = /[\s!"#$&'()*;<>?[\\\]^`{|}~]/g;

/**
 * Paths as one paste that a shell and claude both read as those paths: each with its shell-special characters behind a backslash, joined by spaces.
 * Not quoted, as main's `shellQuote` quotes: claude 2.1.302 splits a paste into paths only at a space before a `/` or a drive, which a quote in front of each would hide, and takes the backslashes away again before it looks at a path.
 */
export function pastedPaths(paths: readonly string[]): string {
  return paths.map((path) => path.replace(SHELL_SPECIAL, '\\$&')).join(' ');
}
