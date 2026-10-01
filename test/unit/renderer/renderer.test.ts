import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The stylesheets in the order the bundle carries them, which is the order their modules are first imported, starting from `renderer.ts` (docs/architecture.md § UI conventions).
 * Two rules of equal specificity in different files are decided by it, so an import that moves can change what something looks like with nothing in the CSS's own diff to show it.
 * When this list has to change, the style capture comes first: one capture before the change and one after, compared with `diff -r` (docs/architecture.md § The window's checks).
 */
const ORDER = [
  'src/renderer/base.css',
  'src/renderer/tooltip.css',
  'src/renderer/menu.css',
  'src/renderer/toast.css',
  'src/renderer/notifications.css',
  'src/renderer/modal.css',
  'src/renderer/dialogs.css',
  'src/renderer/projectgone.css',
  'src/renderer/chrome.css',
  'src/renderer/flash.css',
  'src/renderer/resizer.css',
  'src/renderer/card.css',
  'src/renderer/panels/tree.css',
  'src/renderer/panels/types/claude/index.css',
  'src/renderer/panels/types/sessions/index.css',
  'src/renderer/panels/types/command.css',
  'src/renderer/panels/types/list.css',
  'node_modules/@xterm/xterm/css/xterm.css',
  'src/renderer/panels/types/terminal.css',
  'src/renderer/panels/types/claude/history/bar.css',
  'src/renderer/pill.css',
  'src/renderer/panels/types/claude/history/view.css',
  'src/renderer/panels/types/claude/terminals.css',
  'src/renderer/panels/types/claude/pane.css',
  'src/renderer/panels/types/claude/tab-bar.css',
  'src/renderer/panels/types/sessions/switcher.css',
  'src/renderer/panels/types/sessions/attention-strip.css',
  'node_modules/air-datepicker/air-datepicker.css',
  'src/renderer/panels/types/sessions/filter.css',
  'src/renderer/panels/types/sessions/list.css',
];

/** The stylesheets in the bundle, in order, read from the line esbuild writes before each file's rules when it does not minify. */
async function bundledStylesheets(): Promise<string[]> {
  const result = await build({
    entryPoints: [`${root}src/renderer/renderer.ts`],
    bundle: true,
    format: 'esm',
    outfile: `${root}dist/renderer/renderer.js`,
    write: false,
    absWorkingDir: root,
    logLevel: 'silent',
  });
  const css = result.outputFiles.find((file) => file.path.endsWith('.css'));
  return [...(css?.text ?? '').matchAll(/^\/\* (.+\.css) \*\/$/gm)].map((match) => match[1]);
}

describe('the bundle', () => {
  it('carries the stylesheets in the order they were last checked in', async () => {
    expect(await bundledStylesheets(), 'the stylesheets moved: capture the styles before and after, then update ORDER').toEqual(ORDER);
  });
});
