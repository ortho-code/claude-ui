/**
 * The switches the window's renderer starts with, apart from `main.ts`, which runs the app when imported, so a test can hold them.
 * The language setting goes in as Chromium's `--lang`, which is what a time field formats in: a renderer's field keeps the language it started with, so a window made after a change follows it, and one already open does not (docs/architecture/window.md § The language).
 * None for the system's, `""`, which leaves the renderer to Chromium's own reading of the system.
 */
export function rendererArguments(locale: string): string[] {
  return locale === '' ? [] : [`--lang=${locale}`];
}
