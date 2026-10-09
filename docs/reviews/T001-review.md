# T001 review — 2026-10-09

Ticket: `tasks/T001-repo-scaffold.md` (spec §2.1, §2.3, §13.1).
Scope: uncommitted scaffold (`git status`: `M .gitignore` + 17 new files, nothing staged).

## Acceptance criteria (§5)

| # | Criterion | Result |
|---|---|---|
| 1 | Root `package.json`: `private`, `type: module`, workspaces, `engines >=22` | PASS |
| 2 | Root defines exactly `dev/build/start/test/lint/format/typecheck` | PASS |
| 3 | Stubs print script + owner, exit non-zero (verified `test` → exit 1) | PASS |
| 4 | `npm run build` exits 0, emits `shared/dist`, `server/dist`, skips client (`--if-present`; dists present) | PASS |
| 5 | Install with no compiler toolchain (lock: 0 `node-gyp`, 0 `prebuild-install`) | PASS |
| 6 | `sharp` smoke prints `sharp ok` + int (got `sharp ok 93`) | PASS |
| 7 | `hasInstallScript` only `esbuild` or justified in commit message | FAIL |
| 8 | `npm ls @slydr/shared` linked under server + client | PASS |
| 9 | `shared/package.json` has no `dependencies`/`peerDependencies`/`optionalDependencies` | PASS |
| 10 | `tsc --noEmit` exits 0 for shared, server, client (all ran 0) | PASS |
| 11 | Base `strict: true`; NodeNext shared/server, `bundler` client; no `composite`/`references` | PASS |
| 12 | `.gitignore` covers `node_modules/dist/.env/test-results`/caches, keeps `docs/codemie`; lock not ignored | PASS |
| 13 | `.nvmrc` contains `22` | PASS |
| 14 | One commit; `ls-files` has spec/reqs/tasks + §4.1 files; no `node_modules`/`dist` tracked | FAIL |
| 15 | No root `README.md`; no files under `tasks/` modified | PASS |

Clean code / strictness: placeholders only, no logic; `noUncheckedIndexedAccess`, `verbatimModuleSyntax` set; no `import type` violations possible. Tests: none required by ticket (§6). No source edits made by this review.

## Findings

package-lock.json:1: BLOCKER §4.1 files plus package-lock.json unstaged and uncommitted, so criterion 14 unverifiable. Stage exactly per §4.10 step 5 and commit with `chore: scaffold npm workspaces monorepo`, no push.
package.json:1: MAJOR repo already holds 6 commits, so criterion 14 "exactly one commit" unsatisfiable without history rewrite. Record waiver or amend ticket instead of rewriting history.
package-lock.json:4182: MINOR `hasInstallScript: true` on esbuild (expected), fsevents:4752 and sharp:6987 need commit-message justification per §4.3. State both run no compiler step in initial commit message.
