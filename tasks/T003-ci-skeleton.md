# T003 — Add GitHub Actions CI skeleton

**Epic:** E1 — Repo scaffold
**Spec sections:** §12.5, §2.3, NFR-1
**Depends on:** T001, T002
**Estimated size:** M

---

## 1. Context

Slydr must run identically on Windows, macOS and Linux (NFR-1), and the specification
requires CI to prove it: a GitHub Actions matrix over `windows-latest`, `macos-latest` and
`ubuntu-latest`, each on Node 22 and Node 24. One check is singled out as a **release
blocker** in §12.5: `sharp`, the native image library used for thumbnails, must install from
a **prebuilt binary** with no C/C++ compiler toolchain on any leg of the matrix (§2.3 states
the general rule: no dependency may require a compiler at install time).

This ticket adds that workflow as a skeleton: install, a hard verification that no compiler
was involved, then typecheck, lint, unit/API/component tests and build.
End-to-end (e2e) testing is out of scope; the workflow has no browser-testing step. The ticket also adds two small helper scripts that
perform the verification, and tests for them, so the release-blocker check is itself tested.

## 2. Scope

### In scope

- `.github/workflows/ci.yml` with the six-leg matrix and the steps listed in §4.1.
- `scripts/check-install-log.mjs`: scans the captured `npm ci` output for evidence that a
  compiler toolchain or native-build tool ran, and fails if any is found.
- `scripts/verify-sharp.mjs`: proves `sharp` resolved a prebuilt platform binary and can
  actually resize an image, and fails otherwise.
- Tests: `server/test/scripts/checkInstallLog.test.ts`,
  `server/test/scripts/verifySharp.test.ts` and `server/test/ci/workflow.test.ts`.
- A documented procedure for tightening tolerant steps as later tickets land (§4.5).

### Out of scope

- End-to-end (e2e) testing is out of scope. Do **not** add a browser-installation step or
  any additional test job here, not even a disabled or
  `continue-on-error` one.
- Release or publishing automation, Dependabot, CodeQL, caching of build output, coverage
  upload, and status-badge README edits (README is epic E25).
- A `format:check` step. *Decision (not specified):* §12.5 lists exactly install, typecheck,
  lint, tests and build. Formatting is enforced locally by `npm run format:check` and is
  not a CI gate in this ticket.
- Intel macOS runners. `macos-latest` is Apple Silicon (`darwin-arm64`). The specification's
  prebuilt-binary list also names `darwin-x64`; covering it is a follow-up if a runner label
  for it is wanted.
- Changing any root script. This ticket does not edit `package.json`.

## 3. Prerequisites and assumed state

T001 and T002 are complete and committed. Facts this ticket relies on:

- Root `package.json` (`"type": "module"`, workspaces `shared`, `server`, `client`) defines
  these **working** scripts:

  | Script | Behaviour after T002 |
  |---|---|
  | `npm run typecheck` | builds `@slydr/shared`, then `tsc -p tsconfig.json --noEmit`, then each workspace's `typecheck` |
  | `npm run lint` | `eslint .` |
  | `npm test` | builds `@slydr/shared`, then `vitest run` over projects `shared`, `server` (node) and `client` (jsdom) |
  | `npm run build` | `npm run typecheck`, then builds `shared`, `server` and (only if it defines `build`) `client` |

- `package-lock.json` is committed at the repo root. `.nvmrc` contains `22`. Line endings are
  forced to LF by `.gitattributes`.
- `sharp` is a dependency of `@slydr/server` at `~0.34.4`. Since version 0.33 it ships native
  code as separate optional packages named `@img/sharp-<platform>-<arch>` (for example
  `@img/sharp-win32-x64`, `@img/sharp-darwin-arm64`, `@img/sharp-linux-x64`) plus
  `@img/sharp-libvips-<platform>-<arch>`; npm installs the one matching the machine. Their
  presence, and the absence of a local `node_modules/sharp/build` directory, is what
  "prebuilt" means here.
- ESLint (T002) lints `scripts/**/*.mjs` with Node globals, and Prettier formats them.
- Vitest's `server` project includes `server/test/**/*.test.ts` and has a 15 s test timeout.
- The repository may not yet have a GitHub remote. The workflow file is still committed; the
  first real run happens when the repository is pushed.

## 4. Implementation detail

### 4.1 `.github/workflows/ci.yml`

Create exactly this file.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  verify:
    name: ${{ matrix.os }} / node ${{ matrix.node }}
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
        node: ['22', '24']
    defaults:
      run:
        shell: bash
    env:
      CI: 'true'
      NPM_CONFIG_FUND: 'false'
      NPM_CONFIG_AUDIT: 'false'
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

      - name: Verify sharp resolved a prebuilt binary and works
        run: node scripts/verify-sharp.mjs

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Build
        run: npm run build

      - name: Upload install log on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: install-log-${{ matrix.os }}-node${{ matrix.node }}
          path: install.log
          if-no-files-found: ignore
```

Explanation of the choices, all of which must be kept:

- **Matrix.** Exactly `{windows-latest, macos-latest, ubuntu-latest}` × Node `{'22', '24'}`
  as in §12.5, giving six jobs named like `windows-latest / node 22`. Node versions are quoted
  strings so YAML does not read `22` as a number and so `setup-node` resolves the latest 22.x
  (Vite 7 needs 22.12 or newer within the 22 line, so never pin an old 22.x).
- **`fail-fast: false`.** One failing leg must not hide the results of the other five;
  a platform-specific failure is the whole point of the matrix.
- **`shell: bash` for every step.** On `windows-latest` the default shell is PowerShell. Git
  Bash is preinstalled on the Windows runner, so forcing `bash` gives `tee`, `grep` and quoting
  that behave the same on all three OSes. GitHub invokes an explicit `bash` shell with
  `-e -o pipefail`, so a failing `npm ci` is **not** masked by `| tee`. This relies on that
  behaviour: do not change `shell: bash` to `shell: sh`.
- **`npm ci --foreground-scripts`.** `npm ci` installs exactly what `package-lock.json`
  records and fails if the lockfile is out of sync with the manifests. `--foreground-scripts`
  makes npm print the output of any dependency lifecycle script (including the
  `> pkg@x install` banner and `node-gyp rebuild` line, if one were ever run) into the log
  instead of hiding it, which is what the next step inspects. `2>&1 | tee install.log` captures
  both streams while still showing them live.
- **`cache: npm`.** `actions/setup-node` caches the npm download cache, keyed on the root
  `package-lock.json`, per operating system. It does not cache `node_modules`, so `npm ci`
  still performs a full, honest install every run (important for the verification).
- **Least privilege.** `permissions: contents: read`; the job needs nothing else. The upload
  step uses the job's own token implicitly and needs no extra permission.
- **`concurrency`.** A new push to the same ref cancels the superseded run.
- **Failure artefact.** `install.log` is uploaded only on failure, so a "compiler needed"
  failure on a remote leg can be diagnosed without re-running.
- **Action versions.** `checkout@v5`, `setup-node@v5`, `upload-artifact@v4` — major-version
  tags. If one of these tags does not exist when the file is written, use the newest existing
  major and record it in the commit message.

Do not add `continue-on-error`, `|| true`, `if: always()` on a verification step, or
`npm install` in place of `npm ci`.

### 4.2 `scripts/check-install-log.mjs`

Scans a captured install log for evidence that a native build ran. This is the "inspect the
install log for `node-gyp`" requirement.

```js
// Fails when an npm install log shows compiler-toolchain or native-build activity.
// Usage: node scripts/check-install-log.mjs <path-to-install-log>
// Exit codes: 0 clean, 1 forbidden activity found, 2 unusable input.
import { readFileSync } from 'node:fs';

const FORBIDDEN = [
  { label: 'node-gyp', pattern: /node-gyp/i },
  { label: 'gyp output', pattern: /\bgyp (ERR!|info|WARN)/i },
  { label: 'prebuild-install', pattern: /prebuild-install/i },
  { label: 'node-pre-gyp', pattern: /node-pre-gyp/i },
  { label: 'cmake-js', pattern: /cmake-js/i },
  { label: 'MSBuild', pattern: /\bmsbuild\b/i },
];

const logPath = process.argv[2];
if (!logPath) {
  console.error('Usage: node scripts/check-install-log.mjs <install-log>');
  process.exit(2);
}

let text;
try {
  text = readFileSync(logPath, 'utf8');
} catch (error) {
  console.error(`[slydr] cannot read install log "${logPath}": ${error.message}`);
  process.exit(2);
}

const lines = text.split(/\r?\n/);
if (lines.every((line) => line.trim() === '')) {
  // An empty log means the capture step is broken, not that the install was clean.
  console.error('[slydr] install log is empty; refusing to treat that as a pass.');
  process.exit(2);
}

const hits = [];
lines.forEach((line, index) => {
  for (const { label, pattern } of FORBIDDEN) {
    if (pattern.test(line)) hits.push(`  line ${index + 1} [${label}]: ${line.trim()}`);
  }
});

if (hits.length > 0) {
  console.error('[slydr] FAIL: the install appears to have invoked a native build toolchain.');
  console.error('[slydr] Specification 2.3 forbids dependencies that need a compiler at install time.');
  console.error(hits.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log(`[slydr] OK: no compiler-toolchain activity in install log (${lines.length} lines scanned).`);
```

Notes: matching is case-insensitive and line-based; it deliberately does not match generic
words such as `make` or `gcc`, which could appear in unrelated package names. The six patterns
cover how every mainstream native-addon route announces itself. The log must be the output of
`npm ci --foreground-scripts`, otherwise lifecycle output would be hidden and the check would
be vacuous.

### 4.3 `scripts/verify-sharp.mjs`

This is the `node -e` smoke test of the requirement in file form. *Decision (not specified):*
a script file is used instead of an inline `node -e "..."` string because the inline form
needs different quoting on `cmd`, PowerShell and Bash, and a file can be linted, formatted and
unit-tested. It does exactly what the one-liner would: import `sharp` and resize a generated
buffer.

```js
// Proves sharp installed a prebuilt binary and can run the thumbnail pipeline.
// Usage: node scripts/verify-sharp.mjs
// Exit codes: 0 ok, 1 failed.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(message) {
  console.error(`[slydr] sharp check FAILED: ${message}`);
  process.exit(1);
}

// Resolve sharp exactly as the server would: from the server workspace.
const requireFromServer = createRequire(new URL('../server/package.json', import.meta.url));
let sharpEntry;
try {
  sharpEntry = requireFromServer.resolve('sharp');
} catch (error) {
  fail(`cannot resolve "sharp" from server/: ${error.message}`);
}
const sharpDir = path.resolve(path.dirname(sharpEntry), '..');
const nodeModulesDir = path.dirname(sharpDir);

// 1. A source build leaves node_modules/sharp/build. Prebuilt installs never create it.
if (existsSync(path.join(sharpDir, 'build'))) {
  fail(`${path.join(sharpDir, 'build')} exists, which indicates a compiled-from-source install.`);
}

// 2. A platform package with a native .node file must be present.
const platforms = process.platform === 'linux' ? ['linux', 'linuxmusl'] : [process.platform];
const candidates = platforms.map((platform) => `@img/sharp-${platform}-${process.arch}`);
const roots = [nodeModulesDir, path.join(sharpDir, 'node_modules')];
const binary = candidates
  .flatMap((name) => roots.map((root) => path.join(root, name, 'lib')))
  .find((libDir) => existsSync(libDir) && readdirSync(libDir).some((f) => f.endsWith('.node')));
if (!binary) {
  fail(
    `no prebuilt package found (looked for ${candidates.join(' or ')}). ` +
      'If this is a lockfile generated on another OS, regenerate it with a clean npm install.',
  );
}

// 3. The binary must load and run the same operations the thumbnail pipeline uses.
const { default: sharp } = await import(pathToFileURL(sharpEntry).href);
const width = 64;
const height = 48;
const input = Buffer.alloc(width * height * 3, 128);
try {
  const { data, info } = await sharp(input, { raw: { width, height, channels: 3 } })
    .rotate()
    .resize(16, 16, { fit: 'cover', position: 'centre' })
    .webp({ quality: 72, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const isWebp =
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (info.format !== 'webp' || info.width !== 16 || info.height !== 16 || !isWebp) {
    fail(`unexpected output: ${JSON.stringify(info)}`);
  }
} catch (error) {
  fail(`resize pipeline threw: ${error.message}`);
}

console.log(
  `[slydr] OK: sharp ${sharp.versions.sharp ?? ''} (libvips ${sharp.versions.vips}) ` +
    `using prebuilt binary in ${binary}`,
);
```

What each check proves:

1. **No `node_modules/sharp/build` directory** — the artefact of a local compile.
2. **A `.node` file inside `@img/sharp-<platform>-<arch>/lib`** — the prebuilt addon exists.
   On Linux both glibc (`linux`) and musl (`linuxmusl`) names are accepted, since the check
   must not be wrong on Alpine-based developer containers.
3. **A real resize** — raw RGB buffer → `.rotate()` → `.resize(16, 16, { fit: 'cover' })` →
   `.webp({ quality: 72, effort: 4 })`, the same option set as the §5.6 thumbnail pipeline,
   and a `RIFF....WEBP` header check on the result. This catches a binary that is present but
   cannot load (missing libvips, wrong architecture).

### 4.4 Behaviour of each workflow step, and failure meaning

| Step | Fails when | Meaning |
|---|---|---|
| Install | `npm ci` exits non-zero | Lockfile out of sync, registry problem, or a dependency needed a compiler and could not build. `pipefail` ensures `tee` does not hide this. |
| Verify no compiler toolchain | `check-install-log.mjs` exits 1 or 2 | A dependency invoked `node-gyp`, `prebuild-install`, `node-pre-gyp`, `cmake-js` or MSBuild, or the log is missing/empty. **Release blocker (§12.5).** |
| Verify sharp prebuilt | `verify-sharp.mjs` exits 1 | `sharp` has no usable prebuilt binary on this OS/arch/Node. **Release blocker (§12.5).** |
| Typecheck / Lint / Test / Build | the npm script exits non-zero | An ordinary defect on that platform. |

The two verification steps run **before** typecheck, lint, test and build so that a toolchain
problem is reported as such rather than being buried among thousands of lines of later
output.

### 4.5 Stub tolerance, and how to tighten it

After T001 and T002 every command the workflow runs is a real implementation, so **no CI
step tolerates a missing or stub script**: a stub exits 1 by design (`scripts/not-implemented.mjs`)
and would fail the job, which is intended. Never add `--if-present`, `|| true` or
`continue-on-error` to the workflow to hide one.

Two things are currently incomplete and are tolerated at the *script* level, not the workflow
level:

| Gap | Where it is tolerated | Tighten when |
|---|---|---|
| `client` has no `build` script until the client-shell tickets (epic E9) add Vite | root `build` uses `npm run build -w @slydr/client --if-present` (T001) | The ticket that adds the client's `build` script removes `--if-present` from that one command in root `package.json`, so a missing client build becomes a CI failure. |
| Few real tests exist: `npm test` runs only the toolchain smoke tests from T002 | Not tolerated; the suite simply is small | Nothing to tighten; each later ticket adds tests and CI picks them up automatically because Vitest's `projects` globs include `test/**/*.test.ts` (`test/**/*.test.{ts,tsx}` for `client`). |
| Browser-based testing | The workflow has **no** browser-testing step at all. No step installs browsers and no additional test job exists. |
| `start`, `dev` | Not run by CI | Out of CI scope. |

If a later ticket adds a new root script that should gate merges (for example `format:check`),
add it as a new explicit step in this file in that ticket; do not fold it into an existing
step.

### 4.6 Local dry run (before pushing)

On the Windows dev machine, in Git Bash from the repository root:

```bash
rm -rf node_modules shared/dist server/dist
npm ci --foreground-scripts 2>&1 | tee install.log
node scripts/check-install-log.mjs install.log
node scripts/verify-sharp.mjs
npm run typecheck && npm run lint && npm test && npm run build
```

`install.log` is a throwaway file. Add `install.log` to `.gitignore` as part of this ticket
(append one line under the "Logs" section; `*.log` already matches it, so verify with
`git check-ignore install.log` and make no change if that command prints the path).

### 4.7 Cross-platform notes

- **Windows runner:** the bash shell is Git Bash (MSYS). Paths in the scripts are built with
  `node:path` and `URL`, never with literal separators, so the same files run on all legs.
- **macOS runner:** `macos-latest` is arm64; the expected binary package is
  `@img/sharp-darwin-arm64`.
- **Linux runner:** glibc x64; expected `@img/sharp-linux-x64`.
- **Node 24 ships npm 11.** `npm ci` behaviour and flags used here are unchanged between
  npm 10 and 11.
- **Lockfile generated on one OS.** `package-lock.json` must contain the `@img/sharp-*`
  entries for all platforms. If `verify-sharp.mjs` fails on macOS or Linux with "no prebuilt
  package found" while it passes locally on Windows, the lockfile is missing optional
  platform entries: delete `node_modules` and `package-lock.json`, run `npm install` on a
  clean machine with a current npm, and commit the regenerated lockfile. Never `--omit=optional`.

## 5. Acceptance criteria

- [ ] `.github/workflows/ci.yml` exists, is valid YAML, and defines one job `verify` whose
      matrix is exactly `os: [windows-latest, macos-latest, ubuntu-latest]` and
      `node: ['22', '24']` (six legs), with `fail-fast: false`.
- [ ] Every step runs with `shell: bash` (via `defaults.run.shell`).
- [ ] The step order is: checkout, setup-node (with `cache: npm`), `npm ci --foreground-scripts
      2>&1 | tee install.log`, install-log check, sharp check, `npm run typecheck`,
      `npm run lint`, `npm test`, `npm run build`, upload-log-on-failure.
- [ ] The workflow contains no `continue-on-error`, no `|| true`, no `--if-present`, no
      `npm install`, and no browser-testing step.
- [ ] `node scripts/check-install-log.mjs <file>` exits `0` for a log with no forbidden text,
      `1` for a log containing `gyp ERR! find Python`, `1` for a log containing
      `> node-gyp rebuild`, and `2` for a missing or empty file.
- [ ] `node scripts/verify-sharp.mjs` exits `0` on the developer machine and prints a line
      starting `[slydr] OK: sharp`.
- [ ] `node scripts/verify-sharp.mjs` exits `1` when `node_modules/sharp/build` exists
      (temporarily `mkdir node_modules/sharp/build` to confirm, then remove it).
- [ ] The local dry run in §4.6 passes fully on Windows.
- [ ] `git check-ignore install.log` prints `install.log`.
- [ ] After the repository is pushed to GitHub, the workflow shows six passing jobs. If no
      remote exists yet, record in the hand-off message that this criterion is pending the
      first push; all other criteria must still be met.
- [ ] `package.json` is unchanged by this ticket.

## 6. Tests to write

Per specification §12 and the project definition of done. All three files run in the Vitest
`server` project (Node environment). They locate the repository root with
`path.resolve(import.meta.dirname, '../../..')` and run scripts with `process.execPath`
through `node:child_process` (`spawnSync`), never through a shell, so they behave identically
on every OS.

**`server/test/scripts/checkInstallLog.test.ts`**

Each case writes a log into a fresh directory from `fs.mkdtempSync(path.join(os.tmpdir(),
'slydr-log-'))`, runs the script, and removes the directory afterwards.

- `passes on a clean npm ci log` — a realistic log (`added 412 packages in 9s`, a
  `> esbuild@x postinstall` line, `found 0 vulnerabilities`) → status `0`, stdout contains
  `OK`.
- `fails on node-gyp rebuild output` — contains `> node-gyp rebuild` → status `1`, stderr
  names the offending line.
- `fails on gyp ERR output` — contains `gyp ERR! find Python` → status `1`.
- `fails on prebuild-install, node-pre-gyp, cmake-js and msbuild mentions` — table-driven,
  one case per label, each status `1`.
- `matching is case-insensitive` — `NODE-GYP` → status `1`.
- `does not flag unrelated words` — a log containing `gcc` as part of a package name such as
  `libgcc-fixture` and the word `make` → status `0`.
- `exits 2 for a missing file` and `exits 2 for an empty file`.
- `reports at most 20 hits` — a log with 50 offending lines prints 20 and still exits `1`.

**`server/test/scripts/verifySharp.test.ts`**

- `succeeds with the installed prebuilt sharp` — runs the script; status `0` and stdout
  contains `[slydr] OK: sharp` and `libvips`. Use a 30 s timeout (first `sharp` load on a
  cold Windows runner can be slow).
- `fails when a source-build directory exists` — create `node_modules/sharp/build` (resolve
  the sharp directory with `createRequire(import.meta.url)` anchored at `server/package.json`),
  assert status `1` and that stderr mentions `compiled-from-source`, and **remove the
  directory in a `finally` block** so a failed assertion cannot poison later tests.

**`server/test/ci/workflow.test.ts`** — structural guard on the workflow file, using string
checks only (no new YAML dependency). Reads `.github/workflows/ci.yml` as UTF-8.

- `declares the full OS and Node matrix` — contains `windows-latest`, `macos-latest`,
  `ubuntu-latest`, `'22'` and `'24'`.
- `uses bash for all steps` — contains `shell: bash`.
- `runs the required steps in order` — the indices of `npm ci`, `check-install-log.mjs`,
  `verify-sharp.mjs`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` in the
  file text are strictly increasing.
- `does not mask failures` — does not contain `continue-on-error`, `|| true` or `--if-present`.
- `has no browser-testing step` — asserts the workflow contains no browser-install or
  browser-run step; the comment in the test names the ticket that must update this
  assertion (and the step-order expectations) when the workflow is extended.
- `captures the install output` — contains `npm ci --foreground-scripts` and `tee install.log`.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors (the new `.mjs` scripts are linted too).
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `npm run format:check` passes for the new files.
- [ ] The local dry run (§4.6) passes on Windows.
- [ ] The workflow file is committed (message `ci: add GitHub Actions matrix workflow`,
      ending with the `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer). Do not
      push; pushing and observing the six green jobs is the repository owner's step.
- [ ] README updated if setup or user-visible behaviour changed. No change: CI is invisible to
      end users; the README is epic E25.

## 8. Notes and gotchas

- **The sharp check is a release blocker.** Per §12.5, a failure to install `sharp` without
  a compiler on any matrix leg blocks release. Do not mark either verification step
  `continue-on-error`, and do not "fix" a red leg by installing build tools on the runner
  (`apt-get install build-essential`, `choco install visualstudio...`). The fix is always in
  the dependency set.
- **`pipefail` matters.** Without `-o pipefail`, `npm ci | tee` reports `tee`'s exit code and
  a failed install would look green. The explicit `shell: bash` provides it; the workflow
  structure test checks `shell: bash` is present.
- **`--foreground-scripts` makes npm louder**, not different. Without it, npm hides the output
  of lifecycle scripts and the log scan would have nothing to find. Expect a handful of lines
  from `esbuild`'s postinstall; it only validates an already-installed binary and does not
  compile.
- **Log scanning is a heuristic; the binary check is the proof.** A native build that
  somehow produced no matching text would still be caught by `verify-sharp.mjs` check 1
  (`node_modules/sharp/build`) or by `npm ci` itself failing on a runner with no compiler.
  Keep both.
- **Do not add `sharp` environment variables** (`SHARP_IGNORE_GLOBAL_LIBVIPS`,
  `npm_config_sharp_*`) to the workflow to make it pass. If a global libvips is needed, that
  is itself a violation of §2.3.
- **Case-insensitive file systems.** Windows and macOS runners will not catch an import with
  the wrong letter case; the Linux leg will. That is a reason the matrix includes Linux, not
  a defect.
- **Cache keys.** `setup-node`'s cache is keyed on `package-lock.json`. A lockfile change
  correctly invalidates it; no manual cache step is needed.
- **Open items from §16.2** do not affect this ticket.
