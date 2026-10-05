import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Each process reaches another only through IPC, so a source folder may not import from the folders named here.
// The tests, under test/, are outside it on purpose.
const PROCESSES = { main: ['renderer', 'preload'], preload: ['main', 'renderer'], renderer: ['main', 'preload'], shared: ['main', 'preload', 'renderer'] };

// ESLint takes a rule's options from the last block that matches a file, so a block that restricts more repeats its process's pattern rather than adding to it, and no two of the renderer's blocks below cover the same file.
const boundary = (folder, files, ignores = [], ...more) => ({
  files,
  ignores,
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: PROCESSES[folder].map((other) => `**/${other}/**`), message: 'Processes talk only over IPC; code both sides need goes in src/shared.' }, ...more],
    }],
  },
});

// Inside the renderer the patterns are anchored on where each set of files sits, so `../../shared/panels` is never taken for the renderer's `panels/`, and end at the folder's name, so an import of the folder itself (its index.ts) is caught too.
// A path from one built-in reaches the other's folder only by climbing straight into it or by naming it under `types/`, so the two built-ins' patterns take both, however far up the climb goes, and leave a module of the same name elsewhere alone.
// test/unit/boundaries.test.ts crosses each one.
const BUILTINS_APART = 'The two built-ins never import each other’s modules: they ask through the host (Asks) and share the store.';

export default defineConfig(
  { ignores: ['dist/', 'release/'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.main.json', './tsconfig.renderer.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Off because they fight how this code is written rather than catch mistakes in it: shorthand arrows returning void, `!` where the lines just before guarantee a value, records used as maps, deliberate no-ops, `match` without a `g`.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // An empty string falls through to the next choice on purpose wherever `||` meets a string here.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true, allowTypedFunctionExpressions: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  boundary('main', ['src/main/**/*.ts']),
  boundary('preload', ['src/preload/**/*.ts']),
  boundary('shared', ['src/shared/**/*.ts']),
  // The whole renderer, which the blocks below narrow for their own files; none narrows the start-up, the tree, or the modules directly under panels/types/.
  boundary('renderer', ['src/renderer/**/*.ts']),
  boundary('renderer', ['src/renderer/*.ts'], ['src/renderer/renderer.ts', 'src/renderer/view-saving.ts'], {
    regex: '^\\./panels(/|$)',
    message: 'A service sits below the panels, which draw on it, so it never imports from panels/.',
  }),
  boundary('renderer', ['src/renderer/state/**/*.ts'], [], {
    regex: '^\\.\\./panels(/|$)',
    message: 'The store and its views sit below the panels, which read them, so state/ never imports from panels/.',
  }),
  boundary('renderer', ['src/renderer/panels/*.ts'], ['src/renderer/panels/tree.ts'], {
    regex: '^\\./types(/|$)',
    message: 'Only the tree places the panel types; what they share is the contract (contract.ts) and the run code (run.ts).',
  }),
  boundary('renderer', ['src/renderer/panels/types/claude/**/*.ts'], [], { regex: '^(\\.\\./)+sessions(/|$)|(^|/)types/sessions(/|$)', message: BUILTINS_APART }),
  boundary('renderer', ['src/renderer/panels/types/sessions/**/*.ts'], [], { regex: '^(\\.\\./)+claude(/|$)|(^|/)types/claude(/|$)', message: BUILTINS_APART }),
  {
    files: ['**/*.test.ts'],
    extends: [vitest.configs.recommended],
    rules: {
      // Mocks: `require` is all a hoisted factory can use, fakes mirror async APIs without awaiting, and stand-in classes are empty.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
