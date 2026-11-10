import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The stylesheets in the order the bundle carries them, which is the order their modules are first imported, starting from `renderer.ts` (docs/architecture/ui-conventions.md § UI conventions).
 * Two rules of equal specificity in different files are decided by it, so an import that moves can change what something looks like with nothing in the CSS's own diff to show it.
 * When this list has to change, the style capture comes first: two captures of the build before the change, since one alone is no baseline, and one after, compared with `npm run styles:compare` (docs/architecture/build-and-checks.md § The window's checks).
 */
const ORDER = [
  'src/renderer/base.css',
  'src/renderer/ui/tooltip.css',
  'src/renderer/ui/menu-row.css',
  'src/renderer/ui/popover.css',
  'src/renderer/ui/menu.css',
  'src/renderer/ui/toast.css',
  'src/renderer/window/notifications.css',
  'src/renderer/ui/modal.css',
  'src/renderer/ui/decisive-button.css',
  'src/renderer/dialogs/dialogs.css',
  'src/renderer/dialogs/settings/settings.css',
  'src/renderer/status/projectgone.css',
  'src/renderer/window/chrome.css',
  'src/renderer/ui/flash.css',
  'src/renderer/ui/fold-chevron.css',
  'src/renderer/ui/resizer.css',
  'src/renderer/ui/card.css',
  'src/renderer/ui/badge.css',
  'src/renderer/panels/tree.css',
  'src/renderer/panels/types/claude/index.css',
  'src/renderer/status/notleft.css',
  'src/renderer/ui/tab.css',
  'node_modules/@xterm/xterm/css/xterm.css',
  'src/renderer/ui/terminal.css',
  'src/renderer/panels/types/claude/terminals.css',
  'src/renderer/panels/types/claude/tab-bar.css',
  'src/renderer/panels/types/claude/history/bar.css',
  'src/renderer/ui/pill.css',
  'src/renderer/panels/types/claude/history/view.css',
  'src/renderer/panels/types/claude/pane.css',
  'src/renderer/panels/types/sessions/index.css',
  'src/renderer/panels/types/sessions/switcher.css',
  'node_modules/air-datepicker/air-datepicker.css',
  'src/renderer/dialogs/calendar.css',
  'src/renderer/panels/types/sessions/filter.css',
  'src/renderer/panels/types/sessions/drawn.css',
  'src/renderer/panels/types/sessions/folding.css',
  'src/renderer/panels/types/sessions/read.css',
  'src/renderer/dialogs/setasidedialog.css',
  'src/renderer/ui/tone.css',
  'src/renderer/status/prstatus.css',
  'src/renderer/panels/types/sessions/bulk.css',
  'src/renderer/panels/types/sessions/review.css',
  'src/renderer/panels/types/sessions/arrangement.css',
  'src/renderer/panels/types/list.css',
  'src/renderer/panels/tabs.css',
  'src/renderer/panels/types/command.css',
  'src/renderer/panels/types/terminal.css',
  'src/renderer/panels/types/sessions/controls.css',
  'src/renderer/panels/types/sessions/headings.css',
  'src/renderer/panels/types/sessions/rows.css',
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
