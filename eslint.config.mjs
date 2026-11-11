import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // test-results/ is Playwright's output, which a run of the window's checks deletes at its start, so a lint walking the tree beside one failed on the folder gone under it.
  { ignores: ['dist/', 'release/', 'test-results/'] },
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
  // A file past this many lines of code is split along the areas it serves, or says at its top why it belongs together (`eslint-disable max-lines -- <why>`), so growing past it is a choice someone wrote down rather than drift (decision 0203).
  { files: ['src/**/*.ts'], rules: { 'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }] } },
  // A function past this many lines of code is split along the steps it takes, or says above it why it belongs together (`eslint-disable-next-line max-lines-per-function -- <why>`); tests are left out, since a `describe` holds all its tests in one function (decision 0207).
  { files: ['src/**/*.ts'], rules: { 'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }] } },
  { files: ['test/**/*.ts'], rules: { 'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }] } },
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
