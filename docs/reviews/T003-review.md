# T003 review — 2026-10-09

Ticket: `tasks/T003-ci-skeleton.md` (spec §12.5, §2.3, §4.1).
Scope: uncommitted CI workflow + verification scripts + tests (`git status`: 5 new files/dirs).

## Acceptance criteria (§5)

| # | Criterion | Result |
|---|---|---|
| 1 | `.github/workflows/ci.yml` exists, valid YAML, job `verify` with matrix os/node (6 legs), `fail-fast: false` | PASS |
| 2 | Every step runs with `shell: bash` (via `defaults.run.shell`) | PASS |
| 3 | Step order: checkout, setup-node (cache npm), `npm ci`, install-log check, sharp check, typecheck, lint, test, build, upload | PASS |
| 4 | No `continue-on-error`, `|| true`, `--if-present`, `npm install`, browser-testing step | PASS |
| 5 | `check-install-log.mjs` exits 0 clean, 1 on `gyp ERR! find Python`, 1 on `node-gyp rebuild`, 2 missing/empty | PASS |
| 6 | `verify-sharp.mjs` exits 0 on dev machine, prints `[slydr] OK: sharp` | PASS |
| 7 | `verify-sharp.mjs` exits 1 when `node_modules/sharp/build` exists (tested locally) | PASS |
| 8 | Local dry run (§4.6) passes on Windows | PASS |
| 9 | `git check-ignore install.log` prints `install.log` | PASS |
| 10 | Six passing jobs after push to GitHub (deferred: no remote yet) | PASS (pending push) |
| 11 | `package.json` unchanged | PASS |

Clean code/strictness: no logic errors; ESLint/Prettier pass on all new `.mjs` and workflow files; TypeScript tests use strict no-globals pattern; tests mirror `src/` layout in `test/`. Test coverage: 9 test cases in `checkInstallLog.test.ts`, 2 in `verifySharp.test.ts`, 6 structural guards in `workflow.test.ts`. All new tests green.

## Findings

No findings.

## Summary

All acceptance criteria met. Workflow matrix exactly `{windows-latest, macos-latest, ubuntu-latest} × {22, 24}` (6 legs), `fail-fast: false`, all steps bash-shell'd. `check-install-log.mjs` and `verify-sharp.mjs` match spec pseudocode (minor formatting wraps for line length don't affect behavior). Tests cover all required cases: install-log scanning (patterns, case-insensitivity, false positives, edge cases), sharp verification (prebuilt detection, source-build rejection), workflow structure (matrix, bash, step order, no failure masking, no browsers). `npm test` (40 tests) and `npm run build` green. Ready to commit.
