# T002 — Configure ESLint 9 flat config, Prettier and Vitest

**Epic:** E1 — Repo scaffold
**Spec sections:** §2.3, §3.3, §12.1, §13.1
**Depends on:** T001
**Estimated size:** M

---

## 1. Context

Slydr is a TypeScript monorepo (`shared`, `server`, `client`) whose definition of done
(specification §12.6) requires that every change passes `tsc --noEmit`, ESLint and the unit
tests. T001 created the workspaces and declared all the tooling packages, but left the root
scripts `lint`, `format`, `typecheck` and `test` as stubs that fail on purpose. This ticket
makes those four scripts real: one ESLint 9 flat configuration for the whole repository, a
Prettier configuration, and a Vitest "projects" setup that runs the Node-environment suites
(`shared`, `server`) and the jsdom-environment component suite (`client`) with a single
`npm test`.

It also encodes one security rule from specification §3.3 in the linter: raw string
concatenation of input into a path is a defect everywhere except inside the jail module.

## 2. Scope

### In scope

- `eslint.config.js` at the repo root (flat config): TypeScript support, React and
  react-hooks rules scoped to `client/`, Node globals scoped to `server/` and tooling files,
  a "no Node imports" guard in `shared/`, and a `no-restricted-syntax` rule family against raw
  path concatenation in `server/src` (a labelled Decision).
- `.prettierrc` and `.prettierignore`.
- Root `vitest.config.ts` plus one `vitest.config.ts` per workspace, using the Vitest
  `projects` mechanism; `client/test/setup.ts` with React Testing Library cleanup and the
  jest-dom matchers.
- A root `tsconfig.json` that type-checks the four Vitest config files.
- Real implementations of root scripts `lint`, `format`, `typecheck`, `test`, plus the new
  `format:check` and `test:watch`; `build` is updated to run `typecheck` first.
- Four small permanent "toolchain" tests (one per project plus the lint-rule test).
- Reformatting every file created by T001 with Prettier.

### Out of scope

- Any application, shared-domain or UI code — **T004** onwards.
- End-to-end (e2e) testing is out of scope.
- GitHub Actions — **T003**.
- Type-aware ESLint rules (`recommendedTypeChecked`, `parserOptions.projectService`).
  *Decision (not specified):* use the non-type-aware `recommended` set. It is faster, needs no
  tsconfig plumbing across three differently-configured packages, and `tsc --noEmit` already
  catches what type-aware rules would add. Revisit only if a concrete bug class justifies it.
- Code coverage thresholds.
- Browser API stubs for jsdom (`matchMedia`, `IntersectionObserver`, `ResizeObserver`,
  `requestFullscreen`). The tickets that need them add them to `client/test/setup.ts` or to
  the individual test.
- Editing `README.md` or anything under `tasks/`.

## 3. Prerequisites and assumed state

T001 is complete. Specifically:

- The repository is a Git repository with one commit. Root `package.json` has
  `"type": "module"`, workspaces `shared`, `server`, `client`, and these scripts, of which this
  ticket replaces the stubs:

  ```json
  "build": "npm run build -w @slydr/shared && npm run build -w @slydr/server --if-present && npm run build -w @slydr/client --if-present",
  "test": "node scripts/not-implemented.mjs test T002",
  "lint": "node scripts/not-implemented.mjs lint T002",
  "format": "node scripts/not-implemented.mjs format T002",
  "typecheck": "node scripts/not-implemented.mjs typecheck T002"
  ```

- These packages are **already installed** (root devDependencies): `eslint@^9.36.0`,
  `@eslint/js`, `typescript-eslint@^8.44.0`, `eslint-plugin-react@^7.37.5`,
  `eslint-plugin-react-hooks@^5.2.0`, `eslint-config-prettier`, `globals@^16`,
  `prettier@^3.6.2`, `vitest@^3.2.4`, `typescript@^5.9.2`. In `client`: `jsdom@^26.1.0`,
  `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`,
  `@testing-library/user-event`, `@vitejs/plugin-react`, `vite@^7`. In `server`: `express@^5`,
  `supertest`, `@types/node`, `@types/supertest`, `@types/express`. **This ticket installs no
  new dependency.**
- `shared`, `server` and `client` each have `tsconfig.json`; `shared` and `server` also have
  `tsconfig.build.json`. Each workspace `package.json` has a `typecheck` script
  (`tsc -p tsconfig.json --noEmit`); `shared` and `server` have `build`.
- `shared/src/index.ts`, `server/src/index.ts`, `client/src/main.tsx` each contain only
  `export {};` and a comment.
- `@slydr/shared` is consumed through its compiled `dist/` output (T001 §4.5). A fresh
  checkout has no `shared/dist`, so scripts that need it must build it first.
- Module resolution: `shared` and `server` use `NodeNext` (relative imports need a `.js`
  extension), `client` uses `bundler` (no extension). Test files follow the same rule as the
  sources of their workspace.
- Tests live in `<workspace>/test/`, mirroring `src/`.
- `.gitattributes` forces LF line endings.

## 4. Implementation detail

### 4.1 Files to create or modify

```
eslint.config.js                       (new)
.prettierrc                            (new)
.prettierignore                        (new)
tsconfig.json                          (new, root; type-checks tooling configs only)
vitest.config.ts                       (new, root)
shared/vitest.config.ts                (new)
server/vitest.config.ts                (new)
client/vitest.config.ts                (new)
client/test/setup.ts                   (new)
shared/test/toolchain.test.ts          (new)
server/test/toolchain.test.ts          (new)
server/test/lint/pathRules.test.ts     (new)
client/test/toolchain.test.tsx         (new)
package.json                           (modify: scripts only)
```

### 4.2 Root `package.json` scripts

Replace the scripts block with the following. The other keys (name, workspaces, engines,
devDependencies, etc.) are unchanged. `dev` and `start` stay as the T001 stubs.

```json
"scripts": {
  "dev": "node scripts/not-implemented.mjs dev T019",
  "build": "npm run typecheck && npm run build -w @slydr/shared && npm run build -w @slydr/server --if-present && npm run build -w @slydr/client --if-present",
  "start": "node scripts/not-implemented.mjs start T039",
  "test": "npm run build -w @slydr/shared && vitest run",
  "test:watch": "npm run build -w @slydr/shared && vitest",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "npm run build -w @slydr/shared && tsc -p tsconfig.json --noEmit && npm run typecheck --workspaces --if-present"
}
```

How each works:

- `typecheck` first builds `shared` (the other packages type-check against
  `shared/dist/index.d.ts`), then checks the root tooling configs, then runs every workspace's
  own `typecheck` script (`tsc -p tsconfig.json --noEmit`, which includes `src` and `test`).
  This is the "`tsc --noEmit` across workspaces" of §13.1.
- `test` builds `shared` first for the same reason, then runs `vitest run` (single pass, no
  watch), which reads the root `vitest.config.ts` and runs every project.
- `build` now starts with `typecheck`, matching §13.1 ("typecheck, build `shared`, build
  `client`, compile `server`"). The redundant second build of `shared` is cheap and keeps the
  chain readable.
- `lint` is `eslint .` with no `--fix`, so it can be used verbatim in CI. `format` rewrites
  files; `format:check` is the non-mutating form for CI-style checks.
- All scripts use `&&` only, which works in `cmd.exe`, PowerShell-invoked npm, and POSIX
  shells alike.

### 4.3 `.prettierrc`

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

`endOfLine: "lf"` matches `.gitattributes` from T001, so Windows and Unix machines format
identically. Do not add Prettier plugins.

### 4.4 `.prettierignore`

```
node_modules
dist
coverage
.vite
test-results
blob-report
.slydr-cache
package-lock.json
.nvmrc

# Planning documents are authored by hand and must not be reflowed.
tasks
docs/specification.md
docs/user-requirements.md
refinement.md

# Tool output (CodeMie analytics exports), not project source.
docs
```

*Decision (not specified):* the planning documents are excluded so `npm run format` never
produces a noisy diff in them, and `docs/` (tool-generated JSON that already exists in the
working tree) is excluded so `format:check` cannot fail on files the project does not own.
If Prettier later gains generated docs, add them here.

### 4.5 Root `tsconfig.json` (tooling only)

This file exists so that the Vitest config files, which belong to no workspace `src`, are
type-checked by `npm run typecheck`. It does not compile any application code.

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "noEmit": true
  },
  "include": [
    "vitest.config.ts",
    "shared/vitest.config.ts",
    "server/vitest.config.ts",
    "client/vitest.config.ts"
  ]
}
```

`eslint.config.js` is plain JavaScript and is linted but not type-checked.

### 4.6 ESLint: `eslint.config.js`

Use ESLint 9's `defineConfig` and `globalIgnores` helpers from `eslint/config`. Write the file
exactly as follows (adjust only if a package export differs from what is shown, and report
the difference).

```js
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
```

Behaviour that must hold:

- **React rules apply only to `client/`.** Nothing under `server/` or `shared/` is processed
  by `eslint-plugin-react` or `eslint-plugin-react-hooks`.
- **Node globals apply only to `server/`** and to tooling files (root config files and
  `scripts/`). `process`, `Buffer` and `__dirname`-style globals in `client/src` or
  `shared/src` are lint errors under `no-undef`-equivalent TypeScript checking; in practice
  `tsc` catches them first because `shared` has `types: []`.
- `argsIgnorePattern: '^_'` is the convention T008 relies on for unused Express handler
  parameters (`_req`, `_next`).
- The hooks rules are registered manually instead of through the plugin's preset so that the
  configuration does not depend on which preset keys a given plugin version exposes. This is
  also why `react-hooks/exhaustive-deps` is `error`, not the preset's `warn`: the project
  runs lint with zero tolerated warnings.
- `reportUnusedDisableDirectives: 'error'` makes a stale `eslint-disable` comment a failure.

#### Decision (not specified): the raw-path-concatenation guard

Specification §3.3 says: *"Every route obtains its absolute path exclusively through
`resolveSafe`. String concatenation of user input into a path anywhere else is a defect."*
A linter cannot track "user input" precisely, so the guard is a deliberately conservative
syntactic approximation, backed by a mandatory review check.

The three selectors in `rawPathConcatenation` flag, in `server/src/**` only:

1. `+` concatenation with a string literal that contains `/` or `\`
   (for example `root + '/' + name`).
2. A template literal that interpolates something and whose fixed text contains `/` or `\`
   (for example `` `${root}/${name}` ``).
3. Any `req.<anything>` expression appearing inside a call to `join`, `resolve`,
   `normalize`, `readdir`, `readFile`, `stat`, `lstat`, `realpath`, `opendir`, `access`,
   `createReadStream` or `sendFile` (for example `path.join(root, req.query.path)` or
   `fs.readFile(req.params.file)`).

What it deliberately does **not** catch, and what the reviewer must therefore check by hand:

- A value copied out of `req` into a local variable (`const p = req.query.path`) and then
  used in a path call. Review rule: in any route file, the only legal consumer of request
  input that becomes a file-system location is `resolveSafe`.
- `path.join(root, someString)` where `someString` comes from a helper rather than from
  `req`. `path.join` of a verified absolute directory and a `Dirent.name` obtained from
  `readdir` is legitimate (a directory entry name cannot contain a separator); `path.join` of
  anything else is suspect.

The guard also fires on any template literal whose fixed text contains a `/`, including a URL
such as `` `http://${host}:${port}` `` (the `//`). Build URLs with `new URL(...)` instead
(T009 does this for its readiness line).

Where the guard fires on a legitimate use (for example a log message such as
`` `listening on ${host}/${port}` ``), either rewrite it so no separator sits next to an
interpolation, or add `// eslint-disable-next-line no-restricted-syntax -- <reason>` with a
real reason. Because unused disable directives are errors, stale suppressions cannot linger.

The guard is **not** applied to:

- `shared/` — `wireJoin` and the other POSIX wire-path helpers concatenate with `'/'` by
  design and operate only on already-validated wire strings.
- `server/test/**` — fixtures legitimately build paths.
- `client/` — the client never touches the file system.

The rule is scoped to `server/src/**/*.ts`, and `server/src/security/jail.ts` is not
exempted: `resolveSafe` joins validated segments with `path.join(root, ...segments)`, which
none of the selectors match. Should the jail implementation genuinely need an exemption, add
an inline disable with a justification rather than widening the config.

If `esquery` rejects any of the selectors (the `\x2f` escape is how a slash is expressed
inside an esquery regex), keep the same three behaviours but implement them as a small local
rule in `eslint-rules/no-raw-path-concatenation.js` registered as a plugin in the same config
block. The test in §6 defines the required behaviour either way.

### 4.7 Vitest configuration

Use the `projects` option (Vitest 3.2+; the older `vitest.workspace.ts` file is deprecated and
must not be created).

`vitest.config.ts` (root):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['shared', 'server', 'client'],
  },
});
```

`shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
```

`server/vitest.config.ts` is identical except `name: 'server'` and an added
`testTimeout: 15000` (thumbnail and file-system tests are slower than pure unit tests,
especially on `windows-latest`).

`client/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'client',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
```

Settings explained:

- `include` patterns are relative to each project's directory, so `shared` only runs
  `shared/test/**`, and so on.
- **No Vitest globals.** `globals` is left at its default `false`: every test imports
  `describe`, `it`, `expect`, `vi`, `beforeEach` from `'vitest'`. This keeps `tsconfig`
  `types` minimal (`shared` has `types: []`) and avoids global-name collisions.
- `restoreMocks`, `unstubGlobals`, `unstubEnvs` reset `vi.spyOn`, `vi.stubGlobal` and
  `vi.stubEnv` after every test. T008 stubs `process.platform` and relies on this.
- `css.modules.classNameStrategy: 'non-scoped'` keeps CSS-Module class names stable in
  component tests.
- Do **not** set `passWithNoTests`. The toolchain tests below guarantee every project has at
  least one test, so an accidentally empty suite fails rather than passes.

`client/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library only auto-cleans when Vitest globals are enabled.
// They are disabled in this repo, so unmount rendered trees explicitly.
afterEach(() => {
  cleanup();
});
```

### 4.8 Toolchain tests

These four files are permanent. Their job is to prove each project runs in the right
environment and that the cross-package wiring (workspace link to `shared/dist`) works. They
also guarantee `npm test` is never empty.

`shared/test/toolchain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';

describe('shared test project', () => {
  it('runs in a Node environment without browser globals', () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
  });

  it('can import the package entry point', () => {
    expect(typeof shared).toBe('object');
  });
});
```

`server/test/toolchain.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import * as shared from '@slydr/shared';
import { describe, expect, it } from 'vitest';

describe('server test project', () => {
  it('runs in a Node environment without browser globals', () => {
    expect('window' in globalThis).toBe(false);
    expect(process.versions.node).toMatch(/^\d+\./);
  });

  it('resolves @slydr/shared through its build output', () => {
    expect(typeof shared).toBe('object');
  });

  it('can drive an Express 5 app through Supertest', async () => {
    const app = express();
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    const response = await request(app).get('/ping');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
```

`client/test/toolchain.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import * as shared from '@slydr/shared';
import { describe, expect, it } from 'vitest';

describe('client test project', () => {
  it('runs in a jsdom environment', () => {
    expect('window' in globalThis).toBe(true);
    expect(document.body).toBeInTheDocument();
  });

  it('renders React 19 components and supports jest-dom matchers', () => {
    render(<button type="button">Play</button>);
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('resolves @slydr/shared through its build output', () => {
    expect(typeof shared).toBe('object');
  });
});
```

The lint-rule test is specified in §6.

### 4.9 Formatting the existing files

After adding the configuration, run `npm run format` once. It rewrites all files created by
T001 (and T002) to the Prettier style, then `npm run format:check` must pass. Commit the
reformatting in the same commit as the configuration. Because `tasks/`, `docs/specification.md`
and `docs/user-requirements.md` are in `.prettierignore`, they are untouched.

### 4.10 Cross-platform notes

- **Line endings.** Prettier writes LF (`endOfLine: "lf"`); `.gitattributes` (T001) makes Git
  check out LF on Windows. If `format:check` fails on Windows with every file reported, the
  working tree has CRLF from a checkout made before `.gitattributes` existed; run
  `git add --renormalize .` and re-checkout, do not change Prettier's setting.
- **Globs.** Do not quote or escape globs in npm scripts differently per OS. The scripts use
  `eslint .` and `prettier --write .` precisely because they need no glob at all.
- **Symlink tests.** Later tests (T010) create symlinks, which on Windows may need Developer
  Mode or elevation. Nothing in this ticket creates symlinks, but note that the Vitest
  setup here must not be assumed to run elevated.
- **Case sensitivity.** `forceConsistentCasingInFileNames` (T001) and the relative imports in
  the toolchain tests protect against macOS/Windows case-insensitive filesystems hiding a
  wrong-case import that Linux CI would reject.

## 5. Acceptance criteria

- [ ] `npm run lint` exits 0 on a clean checkout, with no warnings printed.
- [ ] `npm run format:check` exits 0; `npm run format` leaves `git status` clean afterwards.
- [ ] `npm run typecheck` exits 0 and, from a state with `shared/dist` deleted, rebuilds
      `shared` itself before checking `server` and `client`.
- [ ] `npm test` exits 0 from a state with `shared/dist` deleted, and its output lists three
      projects named `shared`, `server` and `client`.
- [ ] `npm run build` exits 0 and runs `typecheck` before compiling.
- [ ] `npm run dev` and `npm start` still exit non-zero via the T001 stub.
- [ ] `eslint.config.js` is an ESLint 9 flat config (`export default defineConfig([...])`);
      no `.eslintrc*` file exists.
- [ ] Adding `const x = req.query.path; ` is not flagged, but adding
      `path.join(root, req.query.path)` to a file in `server/src/` makes `npm run lint` fail
      with a message mentioning `resolveSafe` (checked by the test in §6).
- [ ] Adding `import fs from 'node:fs';` to `shared/src/index.ts` makes `npm run lint` fail.
- [ ] A component in `client/src` that calls `useEffect` with a missing dependency fails lint
      (`react-hooks/exhaustive-deps`), while no React or hooks rule is ever reported for files
      under `server/` or `shared/`.
- [ ] The client toolchain test passes using `toBeInTheDocument` and `toBeEnabled`, proving
      jest-dom is registered with Vitest and the environment is jsdom.
- [ ] The `shared` and `server` toolchain tests pass with `'window' in globalThis === false`,
      proving a Node environment.
- [ ] No Vitest `globals: true`, no `vitest.workspace.*` file and no `passWithNoTests` setting
      exists.
- [ ] `package.json` gained no new dependency (compare `git diff package.json`; only the
      `scripts` block changes) and `package-lock.json` is unchanged.

## 6. Tests to write

Per specification §12.1 and §12.6. All tests import from `'vitest'` explicitly.

The four toolchain test files of §4.8 (`shared/test/toolchain.test.ts`,
`server/test/toolchain.test.ts`, `client/test/toolchain.test.tsx`) cover environments and
wiring. The remaining test covers the lint guard:

**`server/test/lint/pathRules.test.ts`** — drives ESLint's Node API against the real
`eslint.config.js` so the §3.3 guard cannot regress silently.

```ts
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: path.join(repoRoot, 'eslint.config.js') });
});

async function restrictedSyntaxMessages(code: string, relativeFile: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, relativeFile) });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax');
}
```

Cases (each is a separate `it`):

- `flags string concatenation with a slash literal in server source` —
  `const p = root + '/' + name;` in `server/src/services/x.ts` yields exactly one or more
  messages, each mentioning `resolveSafe`.
- `flags a template literal path in server source` — `` const p = `${root}/${name}`; ``.
- `flags a backslash literal concatenation` — `const p = root + '\\' + name;`.
- `flags request data passed to path.join` — `path.join(root, req.query.path);`.
- `flags request data passed to fs.readFile` — `fs.readFile(req.params.file);`.
- `allows spreading validated segments into path.join` — `path.join(root, ...segments);`
  yields zero `no-restricted-syntax` messages.
- `allows wireJoin` — `const p = wireJoin(dir, name);` yields zero.
- `allows template literals without a separator` — `` log(`listening on ${port}`); ``.
- `does not apply to shared` — `const p = dir + '/' + name;` in `shared/src/paths.ts` yields
  zero.
- `does not apply to server tests` — the concatenation case in
  `server/test/services/x.test.ts` yields zero.
- `reports a stale disable directive as an error` — a file in `server/src` containing
  `// eslint-disable-next-line no-restricted-syntax` above a harmless statement produces a
  message whose `ruleId` is `null` and whose text mentions an unused directive.

Also add one assertion to `shared`'s lint coverage in the same file:

- `forbids Node imports in shared` — `import fs from 'node:fs'; export { fs };` linted as
  `shared/src/index.ts` yields a `no-restricted-imports` message.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors and no warnings.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `npm run format:check` passes.
- [ ] `npm run build` runs `typecheck` first and succeeds.
- [ ] The three project names `shared`, `server`, `client` appear in `npm test` output.
- [ ] The reformatted T001 files and the new configuration are committed together
      (one commit, message `chore: add eslint, prettier and vitest tooling`, ending with the
      `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer). Do not push.
- [ ] README updated if setup or user-visible behaviour changed. No README exists yet (epic
      E25); no action.

## 8. Notes and gotchas

- **`eslint-plugin-react-hooks` 5.x** exposes its flat preset under a version-dependent key,
  which is why rules are registered by hand in §4.6. Do not "simplify" by switching to the
  preset without running the lint tests.
- **esquery regex limitation.** A selector regex cannot contain a literal `/`. The
  `String.raw` constant `/[\x2f\\]/` is the portable form; test it before trusting it.
  The §6 test file is the guarantee, not the config file's appearance.
- **Express 5 handler parameters** (`_req`, `_next`) are exempt from `no-unused-vars` via
  `argsIgnorePattern`. T008 depends on this.
- **Duplicate Vite types.** `client/vitest.config.ts` passes `@vitejs/plugin-react` into
  Vitest's config. If `tsc` reports a Vite plugin type mismatch, two copies of `vite` are
  installed; run `npm ls vite` and make sure only Vite 7 is present. Do not paper over it with
  a cast.
- **Test file extensions and ESM.** In `shared/test` and `server/test`, relative imports of
  source need a `.js` suffix (`'../src/index.js'`) because of `NodeNext`; Vitest maps it to the
  `.ts` file. In `client/test` they do not.
- **`shared` must be built before tests.** `server` and `client` tests import `@slydr/shared`
  by name, which resolves to `shared/dist`. That is why `test` and `typecheck` rebuild it.
  If someone runs `npx vitest` directly on a fresh clone and sees "Failed to resolve entry for
  package @slydr/shared", the fix is `npm run build -w @slydr/shared`, not an alias.
- **jsdom gaps.** jsdom lacks `matchMedia`, `IntersectionObserver`, `ResizeObserver`,
  `Element.prototype.scrollIntoView` and the Fullscreen API. Tickets that test the theme,
  explorer and player add the stubs they need (spec §12.3); keep `client/test/setup.ts`
  minimal.
- **Why lint is not type-aware.** See §2; revisit only with a concrete defect class.
- **Spec §16 items** do not apply to this ticket.
