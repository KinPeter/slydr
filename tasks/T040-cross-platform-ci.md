# T040 — Cross-platform CI: complete the workflow with the lockfile gate, NFR rule checks and the Playwright leg

**Epic:** E24 — Cross-platform verification on Windows/macOS/Linux in CI, including the `sharp` prebuilt check
**Spec sections:** §12.5, §2.3 (last paragraph), NFR-1, NFR-7, NFR-9, §3.1, §3.4, §12.4, §12.6
**Depends on:** T003, T038, T039
**Estimated size:** M

---

## 1. Context

Slydr must run identically on Windows, macOS and Linux, and its security model rests on a handful of properties that are easy to break by accident and invisible in a green unit-test run: the server listens on loopback only, never speaks CORS, never makes an outbound network request, and never needs a compiler toolchain at install time. T003 already created the workflow `.github/workflows/ci.yml` (job id `verify`, six legs `{windows-latest, macos-latest, ubuntu-latest}` × Node `{22, 24}`) together with `scripts/check-install-log.mjs` and `scripts/verify-sharp.mjs`, which prove that `sharp` came from a prebuilt binary. This ticket completes that workflow: it adds the five-platform lockfile coverage to the existing `sharp` check, three repository-owned NFR rule checks (static, built output, runtime), the production smoke run from T039, the Playwright leg from T038, and artifact upload on failure.

There is deliberately no bundle-size or startup-time gate (the app runs locally; NFR-8 is a target). The workflow only prints those figures.

## 2. Scope

### In scope

- Editing `.github/workflows/ci.yml` (keep job id `verify`, its name, the matrix, `shell: bash`, `fail-fast: false` and every step T003 defined):
  - build runs **before** the unit tests, so the built-output tests (T039's `builtHtml.test.ts`) really run on every leg;
  - format check, the three NFR rule steps, `smoke:prod`, `check:bundle` (both report-only), Playwright browser install with a cache keyed on the Playwright version, the end-to-end run, artifact upload on failure, an aggregate `ci-ok` job and a weekly scheduled run.
- Extending `scripts/verify-sharp.mjs` (T003) with the lockfile platform-coverage check and an SVG render check; the pure lockfile logic lives in `scripts/ci/lib/sharp-lockfile.mjs`.
- Updating T003's tests: `server/test/ci/workflow.test.ts` (order, e2e now expected) and `server/test/scripts/verifySharp.test.ts` (new lockfile and SVG cases).
- Repository-owned check scripts under `scripts/ci/` (plain ESM `.mjs`, no build step): `check-nfr.mjs` with modes `--static`, `--built`, `--runtime`, and `lib/` helpers (pure rule functions, process spawn helper, tiny fixture builder, outbound-connection preload, directory walker).
- Vitest tests for the check scripts, `scripts/ci/test/*.test.mjs`, run by `npm test` through the root `tooling` project that T037 created.
- Root `package.json` scripts: `ci:nfr:static`, `ci:nfr:built`, `ci:nfr:runtime`.
- `.gitignore`: `.playwright-browsers/`, `ci-logs/`.

### Out of scope

- Playwright configuration and specs, including every CI-conditional Playwright key (`forbidOnly`, `retries`, reporters, `trace`, `outputDir`): **T038** owns them. This ticket does not edit `playwright.config.ts`.
- The browser-side NFR-9 guard (no off-origin request, no CSP console error): **T038**'s `guard` fixture fails every e2e test on either, so no separate browser script exists here.
- Bundle-size or startup-time gates. T019's `size:client` and T039's `smoke:prod` print figures and exit `0`; this ticket only calls them.
- The `docs:check` step: **T041** creates the script and adds the step to this workflow (T041 depends on this ticket).
- The fixture tree generator (T037) and static hosting, CSP and `npm start` (T039); they are consumed or verified from the outside.
- Release automation, Dependabot, matrix legs for ARM Linux or Intel macOS (the lockfile check covers their prebuilt packages statically), README text.
- Firefox and WebKit projects (decision: Chromium only; specification §12.5 is amended accordingly).

## 3. Prerequisites and assumed state

- npm workspaces monorepo (`shared/`, `server/`, `client/`), ESM, TypeScript strict, `engines.node >= 22`, committed `package-lock.json`.
- **T003** provides `.github/workflows/ci.yml` as shown in T003 §4.1: job `verify`, steps checkout (`actions/checkout@v5`), setup-node (`@v5`, `cache: npm`), `npm ci --foreground-scripts 2>&1 | tee install.log`, `node scripts/check-install-log.mjs install.log`, `node scripts/verify-sharp.mjs`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, upload of `install.log` on failure. Its tests live in `server/test/scripts/checkInstallLog.test.ts`, `server/test/scripts/verifySharp.test.ts` and `server/test/ci/workflow.test.ts`. Read the file first; keep what is not listed below.
- **T002** provides `npm run format:check`, `typecheck` (builds `shared` first) and ESLint guards. In particular the `rawPathConcatenation` rule (T002 §4.6) already forbids separator concatenation and separator-bearing template literals in `server/src`; the NFR checks here do not repeat that.
- **T009** provides `server/src/index.ts` (compiled to `server/dist/index.js`): exports `main()` and `BIND_HOST = '127.0.0.1'`, starts `main()` only when it is the entry file, reads `PORT` (default `4317`, tries `+1` to `+9`), `SLYDR_ROOT`, `SLYDR_CACHE_DIR`, `SLYDR_CACHE_MAX_MB`, `SLYDR_QUIET`, binds with `server.listen(port, host)` where `host` comes from `BIND_HOST`, and writes one JSON object per line to stdout, for example `{"ts":"…","level":"info","event":"server.listening","host":"127.0.0.1","port":4317,"url":"http://127.0.0.1:4317","root":"…","rootOverridden":false}`. When `SLYDR_ROOT` is set it logs a `level: "warn"` line containing `TEST-ONLY` before `server.listening`; that warning is exempt from `SLYDR_QUIET`.
- **T008** provides the transport guards (`405 METHOD_NOT_ALLOWED`, `403 FORBIDDEN_HOST`, no CORS, error bodies `{ "error": { "code", "message" } }`).
- **T039** provides static hosting of `client/dist`, `nosniff` and the CSP on the HTML document, `npm start`, and the opt-outs for browser auto-open: `SLYDR_NO_OPEN=1`, `--no-open`, `NODE_ENV=test`; auto-open is opt-in through `--open`, which only `npm start` passes. It also provides `npm run smoke:prod` and `npm run check:bundle` (both exit `0` on size or time figures) and `server/test/builtHtml.test.ts` (skips itself when `client/dist` is missing).
- **T037** created the root Vitest project `tooling` (`include: ['scripts/**/*.test.{ts,mjs}', 'e2e/support/**/*.test.ts']`).
- **T038** provides `@playwright/test`, `playwright.config.ts` (with CI-conditional keys, `outputDir: 'test-results'`, HTML report in `playwright-report/`, `webServer` that builds and starts the production server on port 4417) and `npm run test:e2e`.
- `sharp` (0.34.x) is a dependency of `server/`; prebuilt packages are `@img/sharp-<platform>-<arch>` and `@img/sharp-libvips-<platform>-<arch>`.

Port allocation across the repository: 4417 Playwright (T038), 4517 `smoke:prod` (T039), 4617 the runtime check in this ticket.

## 4. Implementation detail

### 4.1 Files to create or modify

```
.github/workflows/ci.yml                        # modify (keep job id verify)
.gitignore                                      # + .playwright-browsers/  ci-logs/
package.json                                    # + three scripts (see 4.3)
scripts/verify-sharp.mjs                        # modify (T003): lockfile check + SVG render
scripts/ci/lib/sharp-lockfile.mjs               # pure: REQUIRED_SHARP_PLATFORMS, checkLockfile, expectedPlatformPackage
scripts/ci/check-nfr.mjs
scripts/ci/lib/nfr-rules.mjs                    # pure scanners, unit-tested
scripts/ci/lib/spawn-server.mjs                 # start/stop built server, parse listening port
scripts/ci/lib/fixture.mjs                      # tiny inline fixture tree under os.tmpdir()
scripts/ci/lib/block-outbound.mjs               # --import preload that records non-loopback connects
scripts/ci/lib/walk.mjs                         # recursive file walker (no deps)
scripts/ci/test/nfr-rules.test.mjs
scripts/ci/test/sharpLockfile.test.mjs
scripts/ci/test/walk.test.mjs
server/test/ci/workflow.test.ts                 # modify (T003)
server/test/scripts/verifySharp.test.ts         # modify (T003)
```

Everything in `scripts/ci/` is dependency-free Node (>= 22) ESM using only `node:*` built-ins. Use `node:path`, never hard-coded separators. The scripts must pass the rules they enforce.

### 4.2 `.github/workflows/ci.yml`

Start from T003's file and change it to the version below. Differences from T003: `build` moves before `test`; added steps are marked.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
  schedule:
    # Weekly drift detector (new sharp / Playwright / runner image). Monday 05:17 UTC.
    - cron: '17 5 * * 1'

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

env:
  CI: 'true'
  NPM_CONFIG_FUND: 'false'
  NPM_CONFIG_AUDIT: 'false'
  PW_BROWSERS: chromium
  # One OS-independent browser cache location, read by `playwright install` and `playwright test`.
  PLAYWRIGHT_BROWSERS_PATH: ${{ github.workspace }}/.playwright-browsers

jobs:
  verify:
    name: ${{ matrix.os }} / node ${{ matrix.node }}
    runs-on: ${{ matrix.os }}
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
        node: ['22', '24']
    defaults:
      run:
        shell: bash
    steps:
      - name: Check out
        uses: actions/checkout@v5

      - name: Set up Node.js ${{ matrix.node }}
        uses: actions/setup-node@v5
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - name: Install dependencies (output captured)
        run: npm ci --foreground-scripts 2>&1 | tee install.log

      - name: Verify no compiler toolchain ran during install
        run: node scripts/check-install-log.mjs install.log

      - name: Verify sharp lockfile coverage, prebuilt binary and pipeline
        run: node scripts/verify-sharp.mjs

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: NFR rules - static (sources and manifests)
        run: npm run ci:nfr:static

      - name: Build
        run: npm run build

      - name: NFR rules - built output
        run: npm run ci:nfr:built

      - name: Test
        run: npm test

      - name: NFR rules - runtime (loopback bind, Host check, headers, no outbound)
        run: npm run ci:nfr:runtime

      - name: Production smoke run (reports startup time, never fails on it)
        run: npm run smoke:prod

      - name: Client bundle size (reports, never fails on it)
        run: npm run check:bundle

      - name: Resolve Playwright version
        id: pw
        run: echo "version=$(node -p "require('@playwright/test/package.json').version")" >> "$GITHUB_OUTPUT"

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: .playwright-browsers
          key: pw-${{ runner.os }}-${{ runner.arch }}-${{ steps.pw.outputs.version }}-${{ env.PW_BROWSERS }}

      # `playwright install` skips browsers that are already present, so it is safe on a cache hit.
      # Linux also needs OS libraries (apt), which the cache does not carry.
      - name: Install Playwright browsers (Linux, with OS dependencies)
        if: runner.os == 'Linux'
        run: npx playwright install --with-deps $PW_BROWSERS

      - name: Install Playwright browsers (Windows, macOS)
        if: runner.os != 'Linux'
        run: npx playwright install $PW_BROWSERS

      - name: End-to-end tests
        timeout-minutes: 15
        run: npm run test:e2e

      - name: Upload install log on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: install-log-${{ matrix.os }}-node${{ matrix.node }}
          path: install.log
          if-no-files-found: ignore

      - name: Upload e2e and check diagnostics on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-${{ matrix.os }}-node${{ matrix.node }}
          path: |
            test-results/
            playwright-report/
            ci-logs/
          if-no-files-found: ignore
          retention-days: 14

  # Single status check for branch protection: require `ci-ok`, not the six matrix names.
  ci-ok:
    name: ci-ok
    if: always()
    needs: [verify]
    runs-on: ubuntu-latest
    steps:
      - name: Fail unless every matrix leg succeeded
        run: test "${{ needs.verify.result }}" = "success"
```

Notes:

1. **Job id stays `verify`** (T003). `ci-ok` needs it. The PR description tells the maintainer to mark `ci-ok` as the required status check.
2. **No `--if-present`, `continue-on-error`, `|| true`** anywhere (T003 rule, still tested). `format:check` exists since T002.
3. **No `nodedir` trick.** T003's install-log scan plus the `node_modules/sharp/build` check in `verify-sharp.mjs` already prove that nothing compiled; a second mechanism is not added.
4. **Playwright's webServer** (T038) builds nothing: the `Build` step above produced `client/dist` and `server/dist`, and `npm run test:e2e` reuses them. Artifact paths match T038's `outputDir` (`test-results/`) and HTML report folder (`playwright-report/`); if T038 uses other names, fix the list here, not T038's config.
5. **Chromium only** (decision recorded in specification §12.5); extend `PW_BROWSERS` if T038 ever adds projects.
6. The weekly `schedule:` is a decision, not specified; remove it if the maintainer does not want unprompted runs.
7. T041 adds `- name: README checks` / `run: npm run docs:check` after `Lint`. T040 leaves no placeholder.

### 4.3 Root `package.json` scripts

```json
{
  "scripts": {
    "ci:nfr:static": "node scripts/ci/check-nfr.mjs --static",
    "ci:nfr:built": "node scripts/ci/check-nfr.mjs --built",
    "ci:nfr:runtime": "node scripts/ci/check-nfr.mjs --runtime"
  }
}
```

All scripts exit `0` on success and `1` on any violation, print one line per finding as `FAIL <rule-id>: <message> (<file>[:line])`, and finish with `N checks passed` / `M failed`. They write nothing outside `os.tmpdir()` and `ci-logs/`. Add `.playwright-browsers/` and `ci-logs/` to `.gitignore`.

### 4.4 Extending `scripts/verify-sharp.mjs` (lockfile coverage and SVG)

T003's script proves the current machine has a working prebuilt binary. It cannot prove that the committed lockfile carries the other platforms; npm historically drops optional platform packages from a lockfile generated on a different OS, which makes `npm ci` succeed on that OS but leaves `sharp` unloadable. Add, in `scripts/ci/lib/sharp-lockfile.mjs`:

```js
export const REQUIRED_SHARP_PLATFORMS = ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'];
// win32 ships libvips inside @img/sharp-win32-x64; there is no separate libvips package.
export const NO_LIBVIPS_PACKAGE = new Set(['win32-x64']);

/** @returns {{ ok: boolean, problems: string[], version: string | null }} */
export function checkLockfile(lockJson) { /* … */ }

/** ('win32','x64',false) -> '@img/sharp-win32-x64'; ('linux','x64',true) -> '@img/sharp-linuxmusl-x64' */
export function expectedPlatformPackage(platform, arch, isMusl) { /* … */ }
```

`checkLockfile` requires, for every platform `p` in `REQUIRED_SHARP_PLATFORMS`, the lockfile keys `node_modules/@img/sharp-${p}` and (unless `p` is in `NO_LIBVIPS_PACKAGE`) `node_modules/@img/sharp-libvips-${p}`; and that `node_modules/sharp` (or `server/node_modules/sharp`) has a version matching `^0.34.`. Each problem names the missing package and tells the developer the fix: delete `node_modules` and `package-lock.json`, run `npm install --include=optional` on a clean machine with a current npm (or `npm install --os=<os> --cpu=<cpu> sharp` for the missing platforms), commit the lockfile.

Changes to `scripts/verify-sharp.mjs`:

1. Before the existing checks, read `package-lock.json` (repo root, via `new URL('../package-lock.json', import.meta.url)`), call `checkLockfile`, and `fail(...)` with all problems joined.
2. After the existing resize check, render a small SVG with `{ density: 96 }` (spec §5.6) and assert the result is a PNG (first bytes `89 50 4E 47`): `sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#0a0"/></svg>'), { density: 96 }).png().toBuffer()`. SVG support depends on the libvips build, so this catches a broken libvips package that a PNG-only test would miss.
3. Print `sharp.versions` (sharp, libvips) and `<platform>-<arch>` as T003 already does.

New cases for `server/test/scripts/verifySharp.test.ts`, or in `scripts/ci/test/sharpLockfile.test.mjs` for the pure functions (see §6): the script still exits `0` on the developer machine and `1` when `node_modules/sharp/build` exists (T003 cases unchanged).

### 4.5 `scripts/ci/lib/spawn-server.mjs` and `fixture.mjs`

`spawn-server.mjs` is shared by `check-nfr.mjs --runtime`.

```js
// Single place that knows how to suppress browser auto-open (T039): SLYDR_NO_OPEN=1.
// The scripts also start the server with `node server/dist/index.js` (no --open), never `npm start`.
export const NO_OPEN_ENV = { CI: 'true', SLYDR_NO_OPEN: '1' };

/** @returns {Promise<{ port: number, origin: string, root: string, logLines: string[], errLines: string[], stop(): Promise<void> }>} */
export async function startServer({ root, nodeArgs = [], extraEnv = {}, logFile, basePort = 4617 }) { /* … */ }
```

Behaviour:

1. Verify `server/dist/index.js` exists, otherwise fail with "run `npm run build` first".
2. `child_process.spawn(process.execPath, [...nodeArgs, serverEntry], { cwd: repoRoot, env, stdio: ['ignore','pipe','pipe'] })` with `env = { ...process.env, ...NO_OPEN_ENV, PORT: String(basePort), SLYDR_ROOT: root, SLYDR_CACHE_DIR: <tmpdir>/slydr-ci-cache-<random>, ...extraEnv }`. Never set `SLYDR_QUIET`: the scripts parse the readiness line. No shell.
3. Read stdout line by line; `JSON.parse` each in a `try/catch`; the first object with `event === 'server.listening'` and numeric `port` resolves the promise (fallback regex `/127\.0\.0\.1:(\d+)/`). Timeout 20 s: kill the child and throw an error including captured stdout and stderr. If the child exits before readiness, throw with its exit code and output.
4. `stop()` is idempotent: `child.kill()`, wait for `exit` up to 5 s, then `SIGKILL`; always remove the temp cache directory with `fs.rm(..., { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })` and never let a cleanup error mask the real failure.
5. With `logFile`, `mkdir ci-logs/` and append every line to `ci-logs/<logFile>.log`.

`fixture.mjs` exports `makeFixture(): Promise<{ root, cleanup }>`: `fs.mkdtemp(path.join(os.tmpdir(), 'slydr-ci-'))`, resolved with `fs.realpath` (macOS `/var` → `/private/var`), containing `Pictures/red.png` (1×1 PNG decoded from the canonical base64 `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`), `Pictures/Nested/blue.png` (same bytes), `Pictures/notes.txt`, `Pictures/.hidden/secret.png`, and an empty `empty/` folder. No symlinks (Windows runners may refuse them; symlink escape coverage belongs to T010's tests and T037/T038's fixtures).

### 4.6 `scripts/ci/lib/nfr-rules.mjs` and `check-nfr.mjs --static`

All scanners are pure functions of (POSIX relative path, file text) returning `Finding[]`, `@typedef {{ rule: string, file: string, line: number, message: string }} Finding`. `check-nfr.mjs --static` walks the repository with `lib/walk.mjs` (`walk(dir, { skipDirs, include })` over `fs.readdir(..., { withFileTypes: true })`, sorted, always skipping `node_modules`, `dist`, `.git`, `coverage`, `.fixtures`, `.playwright-browsers`, `test-results`, `playwright-report`, `ci-logs`) and applies each rule to the files in its scope. Rules report **all** findings, not the first. Helpers: `isTestFile(rel)` (`*.test.*`, `*.spec.*`, anything under `/test/`, `/tests/`, `/__tests__/`, `/e2e/`, `/fixtures/`), `stripComments(text)` (removes `/* */`, `<!-- -->` and line comments matching `(^|\s)//.*$`, replacing removed text with the same number of newlines; the leading-whitespace requirement keeps `http://` in strings intact), `lineOf(text, index)`.

| Id | Scope (non-test files) | Violation |
|---|---|---|
| `S1-loopback-bind` | `server/src/**/*.ts` | Literal `'0.0.0.0'` / `'::'`; or a `.listen(` call whose first 240 characters of arguments contain none of: the literal `127.0.0.1`, the identifier `BIND_HOST`, or an identifier matching `/LOOPBACK/i` (T009's real call is `server.listen(port, host)` with `host` from `BIND_HOST`, which must pass); or `BIND_HOST` assigned to anything other than `'127.0.0.1'`. |
| `S1-loopback-bind` | `client/vite.config.ts` | `host: true`, `host: '0.0.0.0'`, `host: '::'`; or no `host: '127.0.0.1'` present at all (dev and preview servers are pinned, spec §3.4). |
| `S1-loopback-bind` | every `package.json` `scripts` value | Contains `--host`. |
| `S2-no-cors` | every `package.json` dependency table; `server/src/**` | A dependency named `cors`; text matching `/access-control-allow-/i`; `from 'cors'`. |
| `S3-no-server-outbound` | `server/src/**/*.ts` | Import of `https` / `node:https` / `node:dns` / `node:dgram` / `node:tls`; a call `fetch(`; `http.request(` / `http.get(` / `https.request(`; `net.connect(` / `net.createConnection(`. (`node:http` for `createServer` or types is allowed.) |
| `S4-no-external-urls` | `client/src/**`, `client/index.html`, `client/public/**`, `shared/src/**` | After `stripComments`, any `https?://<host>` whose host is not in `URL_HOST_ALLOWLIST = ['www.w3.org', 'localhost', '127.0.0.1']`. |
| `S5-no-telemetry-deps` | every `package.json` dependency table | A name matching `TELEMETRY_DEP_PATTERN`: `/^(@sentry\/|@datadog\/|@vercel\/analytics|@segment\/|@amplitude\/|@newrelic\/|@fullstory\/|@opentelemetry\/exporter|@microsoft\/applicationinsights|posthog|mixpanel|amplitude|react-ga|ga-4|universal-analytics|google-analytics|newrelic|logrocket|hotjar|update-notifier)/`. |
| `S6-no-shell` | `server/src/**/*.ts` | `child_process` / `node:child_process` imported from a file whose path does not match `ALLOWED_CHILD_PROCESS = /(^|\/)openBrowser\.ts$/` (T039's opener, the only legitimate spawn); any `shell: true`; any call to `exec(` / `execSync(`. |
| `S7-no-hardcoded-platform` | `server/src/**/*.ts`, `shared/src/**/*.ts` (exempt: `server/src/security/jail.ts` for the drive-letter pattern only) | `process.env.HOME` or `process.env.USERPROFILE` (use `os.homedir()`); a string literal starting with a drive letter (`/['"][A-Za-z]:[\\/]/`); a string literal starting `'/Users/`, `'/home/` or `'/tmp`; `.split('\\')`. Separator concatenation and separator-bearing template literals are **not** checked here: T002's `rawPathConcatenation` ESLint guard owns them. |

Notes: `S3` does not apply to `client/src` (same-origin `fetch` is the only network access there, and `S4` forbids absolute URLs); `S4` ignores comments but not string literals, template literals or JSX attributes.

### 4.7 `check-nfr.mjs --built` (after `npm run build`)

| Id | Check |
|---|---|
| `B1-dist-present` | `client/dist/index.html` and `server/dist/index.js` exist. |
| `B2-dist-no-external-refs` | `client/dist/index.html` has no `<script|link|img|iframe|source>` whose `src`/`href` begins with `http://`, `https://` or `//`; every `.css` under `client/dist` has no `url(` or `@import` pointing at `http(s)://` or `//`. |
| `B3-dist-url-hosts` | Every `https?://<host>` in `client/dist/**/*.js` has a host in `DIST_URL_ALLOWLIST = ['www.w3.org', 'react.dev', 'reactjs.org', 'developer.mozilla.org', 'github.com', 'localhost', '127.0.0.1']` (strings inside React error messages and SVG namespaces, never request targets). Also fail on `sendBeacon(`, `new WebSocket(` and `new EventSource(` anywhere in the bundle. A library that legitimately adds a host goes into the allowlist with a comment naming the library and why it is inert; never widen the pattern. |
| `B4-no-inline-script` | `client/dist/index.html` contains no executable inline `<script>` (regex `/<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/(?:json|ld\+json)["'])[^>]*>/i`) and no inline event-handler attributes (`/\son[a-z]+\s*=/i`). This keeps the `script-src 'self'` CSP survivable (T021 ships the theme script as `/theme-init.js`). |

There is no size check here (see §1).

### 4.8 `check-nfr.mjs --runtime` (after `npm run build`)

Flow: `makeFixture()` → `startServer({ root, nodeArgs: ['--import', preloadHref], extraEnv: { SLYDR_CI_OUTBOUND_LOG: <tmp>/outbound.jsonl }, logFile: 'server-runtime' })` → run the checks sequentially → `stop()` and `cleanup()` in `finally` → read the outbound log → print the summary → exit code. `preloadHref = pathToFileURL(path.join(repoRoot, 'scripts/ci/lib/block-outbound.mjs')).href` (`--import` needs a URL on Windows).

`lib/block-outbound.mjs` is a preload module loaded inside the server process. It patches `net.Socket.prototype.connect` (non-loopback TCP target: append `{"kind":"connect","target":"<host>:<port>"}` to the file named by `SLYDR_CI_OUTBOUND_LOG` and throw `new Error('SLYDR_CI: outbound connection blocked')`; ignore IPC path targets), `dns.lookup` (same for hostnames other than `localhost`; IP literals skipped), `dgram.Socket.prototype.send` (record and throw) and `globalThis.fetch` (non-loopback host: record and reject). If the env var is unset it is a no-op.

| Id | Request / action | Pass condition |
|---|---|---|
| `R1-loopback-only` | Parse the `server.listening` event | `url` starts with `http://127.0.0.1:`. |
| `R1-loopback-only` | For the first non-internal IPv4 address from `os.networkInterfaces()` (SKIP with a printed note if none), `http.get({ host: ip, port, path: '/api/health', timeout: 3000 })`; then the same to `host: '::1'` | Each attempt ends in an error with code in `ECONNREFUSED, ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, EADDRNOTAVAIL, EAFNOSUPPORT` or in a timeout. **Any HTTP response is a failure.** |
| `R2-host-guard` | `GET /api/health` with `Host: evil.example` (`node:http` with an explicit `headers.Host`; `fetch` forbids overriding `Host`) | `403`, `error.code === 'FORBIDDEN_HOST'`. |
| `R2-host-guard` | Same with `Host: localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>` | all `200`. |
| `R3-method-guard` | `POST /api/health` | `405`, `error.code === 'METHOD_NOT_ALLOWED'`. |
| `R4-no-cors` | `GET /api/health` and `GET /` with `Origin: http://evil.example`; `OPTIONS /api/health` | No response header whose lower-cased name starts with `access-control-`; `OPTIONS` returns `405`. |
| `R5-html-headers` | `GET /` | `200`, `content-type` starts `text/html`, `x-content-type-options: nosniff`, `content-security-policy` equals exactly `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'` (compared after trimming a trailing `;` and collapsing whitespace). |
| `R6-traversal` | `GET /api/fs/list?path=../../../etc` | `403`, `error.code === 'OUTSIDE_ROOT'` (NFR-7). |
| `R6-no-leak` | `GET /api/fs/list?path=does-not-exist` | `404 NOT_FOUND`; the raw body contains none of: the fixture root path (either separator style), `ENOENT`, `errno`, `syscall` (spec §3.4/§3.5). |
| `R7-root-warning` | Inspect captured stdout | At least one line with `"level":"warn"` exists (spec §3.1). |
| `R9-api-smoke` | `GET /api/fs/root`; `GET /api/fs/list?path=Pictures`; `GET /api/fs/images?path=Pictures&recursive=true`; `GET /api/image?path=Pictures/red.png`; same with `Range: bytes=0-9`; `GET /api/thumb?path=Pictures/red.png&size=128` twice (second with `If-None-Match` = first `etag`) | `root.path === ''`; list `counts` is `{ folders: 1, images: 1, files: 1 }` (the `.hidden` folder is filtered); images `count === 2`, `truncated === false`; image `200` `content-type: image/png`; ranged request `206`; thumb `200`, `content-type: image/webp`, `cache-control` contains `private`; conditional thumb `304`. Per-OS proof that Express, the jail, the scanner and `sharp` work together. |
| `R8-no-outbound` | After all requests, read `outbound.jsonl` | Absent or empty (print its lines on failure). This is the server-side NFR-9 proof; the browser side is T038's `guard` fixture. |

Use `node:http` for requests that need a custom `Host`, global `fetch` elsewhere; 10 s timeout per request; collect failures instead of throwing so the whole table prints; compare paths only in POSIX form.

### 4.9 Lint and ignore housekeeping

- ESLint: T002 already gives `scripts/**/*.mjs` Node globals; nothing to add. Test files in `scripts/ci/test/` import `describe`, `it`, `expect` from `'vitest'`.
- TypeScript: `scripts/ci` is JSDoc-typed plain JS outside every `tsconfig`; no `// @ts-check` requirement.

## 5. Acceptance criteria

Workflow
- [ ] `.github/workflows/ci.yml` still defines exactly one matrix job `verify` (`fail-fast: false`, `os: [windows-latest, macos-latest, ubuntu-latest]` × `node: ['22', '24']`, `shell: bash`), `npm ci --foreground-scripts` is the only install, and `ci-ok` (`needs: [verify]`, `if: always()`) fails when any leg fails or is cancelled.
- [ ] Step order: install, install-log check, `verify-sharp`, typecheck, lint, format check, `ci:nfr:static`, build, `ci:nfr:built`, `npm test`, `ci:nfr:runtime`, `smoke:prod`, `check:bundle`, Playwright install, `npm run test:e2e`, uploads.
- [ ] No `continue-on-error`, `|| true`, `--if-present`, `npm install` or `pull_request_target` anywhere in the file; `permissions` is `contents: read`.
- [ ] Playwright browsers are cached at `.playwright-browsers` with a key containing OS, arch, Playwright version and `PW_BROWSERS`; Linux installs with `--with-deps`, Windows and macOS without.
- [ ] A failing e2e run uploads `e2e-<os>-node<n>` with `test-results/` and `playwright-report/`; a green run uploads nothing.
- [ ] Concurrency cancels superseded pull-request runs but never a run on `main`.

`sharp` gate
- [ ] `node scripts/verify-sharp.mjs` exits `0` on all six legs and prints the sharp version, libvips version and `<platform>-<arch>`.
- [ ] Removing `node_modules/@img/sharp-linux-arm64` from a scratch copy of `package-lock.json` makes `checkLockfile` report a problem naming that package and the remediation command.
- [ ] An SVG rendered with `density: 96` decodes to a PNG.

NFR rule checks
- [ ] `ci:nfr:static`, `ci:nfr:built` and `ci:nfr:runtime` each exit `0` on a clean tree and print one `PASS`/`FAIL` line per rule id from §4.6 to §4.8.
- [ ] Each rule id has a Vitest case proving it fires on a violating input and stays quiet on a conforming one (§6.1), including `S1` accepting `server.listen(port, host)` when `host` is `BIND_HOST`.
- [ ] The runtime check proves per OS that connecting to the non-loopback IPv4 address and to `::1` does not reach the server, asserts `403 FORBIDDEN_HOST`, `405`, no `access-control-*` header, the exact CSP and `nosniff`, and `403 OUTSIDE_ROOT`.
- [ ] `outbound.jsonl` is empty after the runtime smoke run (fs/list, fs/images, image incl. a `206`, thumb incl. a `304`).
- [ ] No check in this ticket fails on a bundle size or a startup time.

Repository hygiene
- [ ] `server/test/ci/workflow.test.ts` is updated to the new order and to expect `test:e2e` and `playwright`; `server/test/scripts/verifySharp.test.ts` still passes.
- [ ] `.gitignore` contains `.playwright-browsers/` and `ci-logs/`.
- [ ] `npm run typecheck`, `npm run lint` and `npm test` are green on a developer machine; `playwright.config.ts` is untouched.

## 6. Tests to write

All Vitest. The check scripts run in the `tooling` project (`scripts/ci/test/*.test.mjs`); T003's guards run in the `server` project.

### 6.1 `scripts/ci/test/nfr-rules.test.mjs`

Import the pure scanners from `../lib/nfr-rules.mjs` and call them with in-memory strings.

| Test name | Asserts |
|---|---|
| `S1 flags 0.0.0.0 literal in server source` | `app.listen(4317, '0.0.0.0')` → one finding `S1-loopback-bind`. |
| `S1 flags listen without a host` | `app.listen(4317)` → finding. |
| `S1 accepts loopback literal, BIND_HOST and LOOPBACK_HOST` | `server.listen(port, '127.0.0.1')`, `server.listen(port, host)` in a file that defines `BIND_HOST = '127.0.0.1'` with the call written as `listen(port, BIND_HOST)`, and `server.listen(port, LOOPBACK_HOST)` → no findings. |
| `S1 flags a BIND_HOST that is not loopback` | `export const BIND_HOST = '0.0.0.0'` → finding. |
| `S1 flags vite host:true and missing pin` | `server: { host: true }` → finding; no `host:` → finding; `server: { host: '127.0.0.1' }` → none. |
| `S1 flags --host in package scripts` | `{"scripts":{"dev":"vite --host"}}` → finding. |
| `S2 flags cors dependency and ACAO header text` | dependency `cors` → finding; `res.setHeader('Access-Control-Allow-Origin','*')` → finding. |
| `S3 flags fetch, https, dns, net.connect in server code` | one finding per construct; `import http from 'node:http'` → none; test files skipped via `isTestFile`. |
| `S4 flags external url in client source, ignores comments and w3.org` | `'https://example.com/a.js'` → finding; `// see https://example.com` → none; `xmlns="http://www.w3.org/2000/svg"` → none; `'http://localhost:4317'` → none. |
| `S4 does not mangle http:// when stripping comments` | `stripComments("const a = 'http://x.test'; // note")` keeps the URL, drops `// note`. |
| `S5 flags telemetry dependency names` | `@sentry/browser`, `posthog-js`, `mixpanel-browser`, `react-ga4`, `update-notifier` flagged; `react`, `sharp`, `lucide-react`, `@tanstack/react-virtual` not. |
| `S6 allows child_process only in openBrowser.ts` | import in `server/src/openBrowser.ts` → none; same in `server/src/routes/fs.ts` → finding; `shell: true` → finding; `execSync(` → finding. |
| `S7 flags HOME, drive letters and hard-coded user dirs` | `process.env.HOME` → finding; `'C:\\Users\\x'` → finding; `'/home/x'` → finding; `path.join(a, b)` → none; the drive-letter pattern as a regex literal in `jail.ts` → none. |
| `B2 flags external script/link refs in dist html and css` | `<script src="https://cdn.example/x.js">` → finding; `<link href="//fonts.googleapis.com/css">` → finding; `<script src="/assets/index-abc.js">` → none; css `@import url(https://x)` → finding. |
| `B3 allows react.dev strings, flags unknown hosts and beacon/websocket` | `"https://react.dev/errors/418"` → none; `"https://track.example/p"` → finding; `navigator.sendBeacon(` → finding. |
| `B4 flags inline executable script and inline handlers` | `<script>window.x=1</script>` → finding; `<script type="application/json">{}</script>` → none; `<body onload="x()">` → finding. |
| `self-scan: scripts/ci passes S6 and S7` | Read every `scripts/ci/**/*.mjs` (using `walk`), apply `S6`, `S7` with the path rewritten under a fake `server/src/` prefix; expect zero findings. |

### 6.2 `scripts/ci/test/sharpLockfile.test.mjs` and `walk.test.mjs`

`sharpLockfile.test.mjs`:

- `checkLockfile accepts a lockfile with all five platforms` — synthetic `{ packages }` with `@img/sharp-<p>` and `@img/sharp-libvips-<p>` for every entry (no libvips for `win32-x64`) and `node_modules/sharp` at `0.34.4` → `{ ok: true, problems: [] }`.
- `checkLockfile reports each missing platform package by name` — drop `node_modules/@img/sharp-darwin-arm64` → one problem containing `@img/sharp-darwin-arm64` and `npm install`.
- `checkLockfile tolerates missing libvips for win32-x64 only` — drop `@img/sharp-libvips-win32-x64` → ok; drop `@img/sharp-libvips-linux-x64` → problem.
- `checkLockfile rejects a sharp version outside 0.34` — `0.33.5` → problem mentioning `0.34`.
- `expectedPlatformPackage` — `('win32','x64',false)` → `@img/sharp-win32-x64`; `('linux','x64',true)` → `@img/sharp-linuxmusl-x64`; `('darwin','arm64',false)` → `@img/sharp-darwin-arm64`.

`walk.test.mjs`: temp tree (`fs.mkdtemp(path.join(os.tmpdir(), 'walk-'))`) with a nested folder, `node_modules/` and `dist/`; assert `walk` yields real files in sorted order, skips excluded directories, and that `toPosixRel(root, abs)` returns no backslashes.

### 6.3 T003 tests to update

- `server/test/ci/workflow.test.ts`: replace `does not run e2e yet` with `runs the e2e leg` (contains `npm run test:e2e` and `playwright install`); change `runs the required steps in order` to the order in §5 (indices strictly increasing: `npm ci`, `check-install-log.mjs`, `verify-sharp.mjs`, `npm run typecheck`, `npm run lint`, `npm run ci:nfr:static`, `npm run build`, `npm run ci:nfr:built`, `npm test`, `npm run ci:nfr:runtime`, `npm run smoke:prod`, `npm run check:bundle`, `npm run test:e2e`); keep matrix, `shell: bash`, install-capture and `does not mask failures` cases; add `keeps the job id verify` and `defines the ci-ok aggregate job`.
- `server/test/scripts/verifySharp.test.ts`: unchanged cases keep passing; add nothing that depends on a lockfile edit (the lockfile logic is covered by `sharpLockfile.test.mjs`).

### 6.4 Manual verification of the workflow (once, recorded in the PR)

1. Push the branch; six `verify` legs plus `ci-ok` appear and are green.
2. Re-run without changes; the Playwright cache step reports a hit.
3. On a throwaway commit add `test('ci artifact smoke', async ({ page }) => { await page.goto('/'); expect(1).toBe(2); });` to one e2e spec; all legs go red, each uploads `e2e-<os>-node<n>` with a trace and screenshot, and `ci-ok` is red. Revert.

### 6.5 Negative proofs for the NFR gates (throwaway commits, then revert)

Each must turn the named step red; record the observed `FAIL <rule-id>` line in the PR.

- Change the server's `BIND_HOST` to `'0.0.0.0'` → `S1-loopback-bind` and, after build, `R1-loopback-only`.
- Remove the `Host` guard registration → `R2-host-guard`.
- Add `import cors from 'cors'` and `app.use(cors())` (the dependency alone trips it) → `S2-no-cors`.
- Add `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">` to `client/index.html` → `S4-no-external-urls`, `B2-dist-no-external-refs`.
- Add `fetch('https://example.com')` to a server module that runs at startup → `S3-no-server-outbound` and `R8-no-outbound`.
- Add an inline `<script>` to `client/index.html` → `B4-no-inline-script`.
- Pin `sharp` to `0.32.x` in `server/package.json` → the lockfile version check in `verify-sharp.mjs`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors (including `scripts/ci/**/*.mjs`).
- [ ] New logic covered by tests; `npm test` green (it includes the `tooling` project).
- [ ] All six matrix legs and `ci-ok` are green on the PR that introduces this ticket.
- [ ] The negative proofs in §6.5 were performed at least for loopback bind, `Host` guard, external URL in `index.html`, and the failing-e2e artifact upload, and recorded in the PR description.
- [ ] The artifact `path:` list matches T038's real `outputDir` and report folder.
- [ ] The PR description tells the maintainer to mark `ci-ok` as the required status check and lists the six per-leg check names that can be removed from branch protection.
- [ ] README: no change required by this ticket.

## 8. Notes and gotchas

- **`sharp` and npm optional dependencies.** `@img/sharp-*` packages are `optionalDependencies` filtered by `os`/`cpu`/`libc`. A lockfile produced on one OS may lack the others, so `npm ci` on another OS silently installs nothing for `sharp`. That is why the lockfile is verified statically for all five platforms in addition to loading the module. Regenerate the lockfile with all platform packages present before merging a dependency bump.
- **Windows specifics.** Git Bash is used for `run:` steps; spawn `node` via `process.execPath` with an argument array, never through a shell string. `--import` needs a `file://` URL on Windows (`pathToFileURL`). Antivirus locks can make `fs.rm` of the temp fixture throw `EBUSY`/`EPERM`: use `maxRetries: 5, retryDelay: 200` and never let cleanup errors mask the real failure. Windows runners may refuse symlink creation, which is why this ticket's fixture has none.
- **macOS specifics.** `os.tmpdir()` is under `/var/folders`, a symlink to `/private/var`; `realpath` the fixture root before using it as `SLYDR_ROOT` and before comparing paths. Some runner images have no non-internal IPv4: `R1` must `SKIP`, not fail (the static `S1` rule and the `server.listening` URL check still run).
- **Linux specifics.** Chromium needs OS libraries; `--with-deps` handles it and needs `sudo`, which `ubuntu-latest` provides. The browser cache does not include them.
- **Ports.** 4417 (T038), 4517 (T039 smoke), 4617 (this ticket). The scripts parse the real port from the readiness line; they never assume the default.
- **Browser auto-open.** Start the built server directly, never through `npm start`; `NO_OPEN_ENV` is belt and braces.
- **Flakiness policy.** Retries exist only in Playwright (T038 config). The check scripts are deterministic and have no retries; a retry would mask a real intermittent bind or header bug.
- **Cost control.** Six legs; Windows and macOS minutes cost more on private repos. If that matters, restrict the Playwright steps to Node 24 with `if: matrix.node == '24'`; the spec (§12.5) asks for the full matrix, so the default is not to.
- **Not covered here, by design:** visual regression, Lighthouse, a bundle-size or startup gate, accessibility scanning (T036 and T038's `a11y.e2e.ts`), Firefox/WebKit.
