import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The folder boundaries eslint.config.mjs draws, each crossed on purpose and linted through ESLint's own API with the repo's config, so a pattern that misses a spelling, or a block that drops its process's rule (ESLint takes a rule's options from the last block that matches a file), fails here instead of letting a crossing through.
 * Only the import rule runs, and without type information, which it does not need; the files named need not exist, since the text is handed in.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({
  cwd: root,
  ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-imports',
  overrideConfig: { files: ['**/*.ts'], languageOptions: { parserOptions: { project: null } } },
});

/** Each boundary by a phrase of its message in eslint.config.mjs. */
const BOUNDARIES = {
  process: 'Processes talk only over IPC',
  service: 'A service sits below the panels',
  state: 'state/ never imports from panels/',
  types: 'Only the tree places the panel types',
  apart: 'The two built-ins never import',
} as const;
type Boundary = keyof typeof BOUNDARIES;

/** Which boundary an import from `file` crosses, null for none; anything else the linter says comes back as it said it, so it fails the check rather than passing for a boundary. */
async function crossed(file: string, specifier: string): Promise<string | null> {
  const [result] = await eslint.lintText(`import '${specifier}';\n`, { filePath: `${root}${file}` });
  const message = result.messages.at(0);
  if (!message) return null;
  return (Object.keys(BOUNDARIES) as Boundary[]).find((boundary) => message.ruleId === 'no-restricted-imports' && message.message.includes(BOUNDARIES[boundary])) ?? message.message;
}

const cases: [file: string, specifier: string, boundary: Boundary | null][] = [
  // Each process's folder against the others.
  ['src/main/x.ts', '../renderer/state/store', 'process'],
  ['src/main/x.ts', '../preload/preload', 'process'],
  ['src/main/x.ts', '../shared/types', null],
  ['src/preload/x.ts', '../main/config', 'process'],
  ['src/preload/x.ts', '../renderer/state/store', 'process'],
  ['src/shared/x.ts', '../main/config', 'process'],
  ['src/shared/x.ts', '../renderer/state/store', 'process'],

  // The process rule from inside every block that narrows the renderer, each of which has to repeat it, and from what none narrows.
  ['src/renderer/x.ts', '../main/config', 'process'],
  ['src/renderer/renderer.ts', '../main/config', 'process'],
  ['src/renderer/state/x.ts', '../../main/config', 'process'],
  ['src/renderer/panels/x.ts', '../../main/config', 'process'],
  ['src/renderer/panels/tree.ts', '../../main/config', 'process'],
  ['src/renderer/panels/types/x.ts', '../../../main/config', 'process'],
  ['src/renderer/panels/types/claude/x.ts', '../../../../main/config', 'process'],
  ['src/renderer/panels/types/sessions/x.ts', '../../../../main/config', 'process'],

  // A service sits below the panels; the start-up does not.
  // A roundabout way there (`../renderer/panels/tree`) is not caught, and is not crossed here: the pattern stays anchored so `../shared/panels` is not taken for `panels/`, and nobody writes the long way when the short one is what the editor offers.
  ['src/renderer/x.ts', './panels/tree', 'service'],
  ['src/renderer/x.ts', './panels', 'service'],
  ['src/renderer/x.ts', './state/store', null],
  ['src/renderer/x.ts', '../shared/panels', null],
  ['src/renderer/renderer.ts', './panels/tree', null],
  ['src/renderer/view-saving.ts', './panels/tree', null],

  // So does the store.
  ['src/renderer/state/x.ts', '../panels/tree', 'state'],
  ['src/renderer/state/x.ts', '../panels', 'state'],
  ['src/renderer/state/x.ts', '../../shared/panels', null],

  // Only the tree places the panel types.
  ['src/renderer/panels/x.ts', './types/command', 'types'],
  ['src/renderer/panels/x.ts', './types', 'types'],
  ['src/renderer/panels/x.ts', './contract', null],
  ['src/renderer/panels/tree.ts', './types/sessions', null],

  // The two built-ins apart, however the other's folder is spelled.
  ['src/renderer/panels/types/claude/x.ts', '../sessions/list', 'apart'],
  ['src/renderer/panels/types/claude/x.ts', '../sessions', 'apart'],
  ['src/renderer/panels/types/claude/x.ts', '../../types/sessions/list', 'apart'],
  ['src/renderer/panels/types/claude/history/x.ts', '../../sessions/list', 'apart'],
  ['src/renderer/panels/types/claude/history/x.ts', '../../../types/sessions/list', 'apart'],
  ['src/renderer/panels/types/claude/x.ts', '../../../../renderer/panels/types/sessions/list', 'apart'],
  ['src/renderer/panels/types/claude/x.ts', '../../contract', null],
  ['src/renderer/panels/types/claude/x.ts', '../../../state/store', null],
  ['src/renderer/panels/types/claude/x.ts', '../../../state/sessions', null],
  ['src/renderer/panels/types/sessions/x.ts', '../claude/asks', 'apart'],
  ['src/renderer/panels/types/sessions/x.ts', '../claude', 'apart'],
  ['src/renderer/panels/types/sessions/x.ts', '../../types/claude/asks', 'apart'],
  ['src/renderer/panels/types/sessions/x.ts', '../../contract', null],
  ['src/renderer/panels/types/sessions/x.ts', '../../../state/claude', null],
];

describe('the lint boundaries', () => {
  it.each(cases)('%s importing %s crosses %s', async (file, specifier, boundary) => {
    expect(await crossed(file, specifier)).toBe(boundary);
  });
});
