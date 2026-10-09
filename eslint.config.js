import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Selectors for the raw-path-concatenation guard in server/src (spec section 3.3).
// esquery regex literals cannot contain a bare "/", so the slash is written as \x2f.
const SLASH_OR_BACKSLASH = String.raw`/[\x2f\\]/`;

const rawPathConcatenation = [
  {
    selector: `BinaryExpression[operator='+'] > Literal[value=${SLASH_OR_BACKSLASH}]`,
    message:
      'Do not build paths by string concatenation. Obtain absolute paths from resolveSafe() ' +
      '(server/src/security/jail.ts) and wire paths from wireJoin() (@slydr/shared). Spec 3.3.',
  },
  {
    selector: `TemplateLiteral[expressions.length>0] > TemplateElement[value.raw=${SLASH_OR_BACKSLASH}]`,
    message:
      'Do not build paths with template literals containing a path separator. Use resolveSafe() ' +
      'for absolute paths or wireJoin() for wire paths. Spec 3.3.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(join|resolve|normalize|readdir|readFile|stat|lstat|realpath|opendir|access|createReadStream|sendFile)$/] MemberExpression[object.name="req"]',
    message:
      'Request data must not flow directly into a path or file-system call. Pass it through ' +
      'resolveSafe() first. Spec 3.3.',
  },
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.vite/**',
    '**/test-results/**',
    '**/blob-report/**',
    '**/.slydr-cache/**',
  ]),

  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Rules for every TypeScript file in the repo.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // shared/: environment-neutral. No Node or browser globals, no Node imports.
  {
    files: ['shared/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: '@slydr/shared is bundled into the browser; do not import Node modules.',
            },
          ],
          paths: ['fs', 'path', 'os', 'url', 'crypto', 'child_process'],
        },
      ],
    },
  },

  // server/: Node globals, and the raw-path-concatenation guard in source files.
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['server/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...rawPathConcatenation] },
  },

  // client/: React + hooks rules, browser globals.
  {
    ...react.configs.flat.recommended,
    files: ['client/**/*.{ts,tsx}'],
  },
  {
    ...react.configs.flat['jsx-runtime'],
    files: ['client/**/*.{ts,tsx}'],
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: 'detect' } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react/prop-types': 'off',
    },
  },

  // Tooling files at the repo root and in scripts/ run in Node.
  {
    files: ['*.{js,mjs,ts}', 'scripts/**/*.mjs', '*/vitest.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Must be last: disables stylistic rules that Prettier owns.
  prettier,
]);
