# T002 review — 2026-10-09

## Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `npm run lint` exits 0 on clean checkout, no warnings | PASS |
| 2 | `npm run format:check` exits 0; `npm run format` leaves git status clean | PASS |
| 3 | `npm run typecheck` exits 0, rebuilds `shared` from deleted state | PASS |
| 4 | `npm test` exits 0, lists three projects: `shared`, `server`, `client` | PASS |
| 5 | `npm run build` exits 0, runs `typecheck` first | PASS |
| 6 | `npm run dev` and `npm start` still exit non-zero via T001 stub | PASS |
| 7 | `eslint.config.js` is flat config; no `.eslintrc*` file exists | PASS |
| 8 | Request data in path calls flagged; `const x = req.query.path` not flagged | PASS |
| 9 | `import fs from 'node:fs'` in shared fails lint | PASS |
| 10 | Client useEffect missing dependency fails lint; no React rules for server/shared | PASS |
| 11 | Client toolchain test uses `toBeInTheDocument` and `toBeEnabled` (jest-dom, jsdom) | PASS |
| 12 | shared/server toolchain tests confirm Node environment (`'window' in globalThis === false`) | PASS |
| 13 | No `globals: true`, no `vitest.workspace.*`, no `passWithNoTests` | PASS |
| 14 | No new dependencies; `package-lock.json` unchanged | PASS |

## Findings

No findings.

## Details

- **ESLint config**: ESM flat config (eslint.config.js), correct import syntax, no legacy .eslintrc files.
- **Raw path concatenation guard**: Three esquery selectors correctly target `/` and `\` string concatenation and request-data flow into path/fs calls, scoped to server/src only.
- **Prettier**: Config correctly specifies `endOfLine: "lf"` to match .gitattributes; .prettierignore excludes tasks/, docs/specification.md, docs/user-requirements.md as required.
- **Vitest projects**: Root config lists ['shared', 'server', 'client']; each workspace has correct vitest.config.ts with environment (node/jsdom), include patterns, setupFiles.
- **tsconfig.json (root)**: Type-checks only the four vitest.config.ts files; includes base, NodeNext module resolution, ES2023 lib, node types.
- **Test setup**: client/test/setup.ts imports jest-dom vitest integration and cleanup function.
- **Toolchain tests**: 
  - shared: imports from ../src/index.js (NodeNext .js suffix required), verifies Node environment and package import.
  - server: imports @slydr/shared by name (resolves through dist), uses Express + Supertest, verifies Node environment.
  - client: renders React component, uses jest-dom matchers, verifies jsdom environment.
- **Lint guard test** (server/test/lint/pathRules.test.ts): 11 test cases cover all three selector categories (binary +, template literals, request-to-path calls), negatives (spreading, wireJoin, no separator), scope rules (not in shared, not in test/), stale disable directives, and shared Node import restriction.
- **Scripts**: package.json replaced stubs with real implementations; build now runs typecheck first; test and typecheck both rebuild shared before running checks; format:check added; test:watch added.
- **No new dependencies**: package-lock.json unchanged; shared/package.json only reformatted (Prettier).
- **ESLint rules**: @typescript-eslint/consistent-type-imports enforces `import type` (verbatimModuleSyntax); no-unused-vars has argsIgnorePattern for Express handlers; React hooks rules registered manually with error severity; reportUnusedDisableDirectives set to error.

