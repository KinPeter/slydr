# T038 — Playwright end-to-end suite against the production server

**Epic:** E22
**Spec sections:** §12.4, §12.5, §13.1
**Depends on:** T034, T036, T037, T039
**Estimated size:** L

---

## 1. Context

Unit, component and API tests prove the pieces; only a real browser proves that the pieces work together: that the production server serves the built client, that the explorer, configuration and player screens hand state to each other, that settings survive a reload, that the theme is correct before first paint, and that the jail still refuses a crafted path when the request comes through the same origin the user's browser uses. Spec §12.4 lists the five end-to-end scenarios; spec §12.5 requires the Playwright run on every leg of the CI matrix (Windows, macOS, Linux × Node 22 and 24); spec §13.1 defines `npm run test:e2e` as "Playwright".

This ticket delivers the Playwright configuration, a launcher that starts the **production** server (the one `npm start` runs, from T039) against a generated fixture tree (T037), shared test helpers, and the test files for the five scenarios in §12.4 plus a small number of additional checks that belong naturally in a browser run (no console errors, no off-origin requests, a failed thumbnail falling back to an icon, the zero-image state, the depth cap, the narrow viewport). It does not wire the suite into GitHub Actions; that is T040.

Design principles for the suite:

- **Production path only.** Tests run against `node server/dist/index.js` serving `client/dist`, not against Vite. This is the artifact users run, and it is the only place the CSP, the cache headers and the blocking `theme-init.js` script can be verified.
- **Deterministic data.** All expectations about directory contents come from the fixture manifest and its oracle functions (`expectedListing`, `expectedImages`), not from hard-coded counts, so the suite behaves identically on the three operating systems even where symlinks or Windows-hidden names differ.
- **No sleeps.** Waiting is done with Playwright's auto-waiting locators and `expect.poll`. `page.waitForTimeout` and `force: true` are forbidden in this suite.

## 2. Scope

### In scope

- `playwright.config.ts` at the repository root: Chromium project, `webServer` that runs the launcher, `baseURL` `http://127.0.0.1:4417`, artifacts, retries and workers policy.
- `e2e/support/start-server.mjs`: builds the fixture tree, writes the manifest, checks the port, and starts the built server in the same process.
- `e2e/support/`: the extended `test` object (manifest fixture, automatic console-error and off-origin-request guard, configurable allow-list), UI helper functions, keyboard helpers.
- Test files (all named `*.e2e.ts`): `happy-path`, `explorer-views`, `theme`, `security`, `keyboard`, `config-edge-cases`, `responsive`, `a11y` (automated axe scan of the three screens in both themes; the unit-level accessibility work is T036).
- Root devDependency `@axe-core/playwright` (used only by `a11y.e2e.ts`).
- Root scripts `test:e2e`, `test:e2e:ui`, `e2e:install`; `e2e/tsconfig.json` and its inclusion in `typecheck`; `.gitignore`, ESLint and Vitest exclusions.
- Ownership of the CI-conditional Playwright settings (`forbidOnly`, `retries`, `workers`, `reporter`, `trace`, `screenshot`, `outputDir`). T040 only wires the workflow and does not edit `playwright.config.ts`.
- Documented per-platform behaviour and the browser-install commands that T040 will call.

### Out of scope

- The GitHub Actions workflow edits (install browsers, run `npm run test:e2e`, upload traces): **T040**.
- The fixture generator itself: **T037** (consumed as is).
- The production static serving, CSP and `npm start`: **T039** (consumed as is).
- Firefox and WebKit projects. **Owner decision:** v1 runs Chromium only on all three operating systems (spec §12.5 is amended accordingly). The spec requires an OS matrix, not a browser matrix, and one engine keeps the CI time and the flake surface small. Adding projects later is a config-only change.
- Visual-regression screenshots and performance gating. NFR-8 timing is recorded as a test annotation only and never fails a test.
- Fixing accessibility defects that the axe scan finds: those belong to the screen tickets and T036; this ticket reports them.
- Testing native fullscreen end to end (see §8).

## 3. Prerequisites and assumed state

The repository is the npm workspaces monorepo from T001 (`shared/`, `server/`, `client/`; ESM, TypeScript strict, Node >= 22, `@playwright/test` already a root devDependency). CI is the skeleton at `.github/workflows/ci.yml`; its Playwright leg is wired in T040.

From **T037** (`scripts/fixtures.mjs`, typed by `scripts/fixtures.d.mts`): `createFixtureTree(rootDir, opts)` returns a `FixtureManifest` (`rootDir`, `outsideDir`, `platform`, `entries`, `skipped`, `limits`); it refuses to wipe a directory without its marker file `.slydr-fixture-root`; `expectedListing(manifest, wirePath, showHidden)` returns the `ManifestEntry[]` the server must list in order; `expectedImages(manifest, wirePath, { recursive, showHidden })` returns `{ paths, truncated }`. The default tree contains `photos/` (10 visible images and 11 with hidden shown; `IMG_1.jpg`, `IMG_2.jpg`, `IMG_10.jpg` plus png, gif, webp, avif, bmp, svg and `UPPER.JPG`), `Café photos/` (non-ASCII and space), `deep/` (14 nested levels; with `MAX_DEPTH` 12 a recursive scan returns `level-00` to `level-12`), `documents/` (no images), `edge-cases/` (`corrupt.jpg` and `empty.png` whose thumbnails fail with `500 THUMBNAIL_FAILED`, `photo.heic` which is classified as a plain file, `pixel.png`, `pixel.gif`), `empty-folder/`, `links/` (symlinks; may be absent when the platform refuses them, in which case `manifest.skipped` lists them), hidden entries (`.hidden-file.txt`, `.hidden-folder/`, `.hidden-photo.jpg`) and Windows-hidden names (`desktop.ini`, `Thumbs.db`, `$RECYCLE.BIN`). The tree is created under a directory the launcher chooses, and the server must be started with `SLYDR_ROOT` set to `manifest.rootDir`.

From **T039**: `npm run build` produces `server/dist/index.js` and `client/dist/index.html`; running `node server/dist/index.js` (without `--open`) serves the API and the client on one origin and never opens a browser; `PORT` selects the port (with `+1..+9` retry on `EADDRINUSE`, which this suite must not rely on); `SLYDR_QUIET=1` suppresses the banner; `SLYDR_NO_OPEN=1` suppresses browser opening; HTML responses carry `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'` and `X-Content-Type-Options: nosniff`; unknown non-API paths return a plain `404`.

From the server (T008–T018): `GET /api/health` returns `{ "status": "ok", "version": "…" }`; errors use `{ "error": { "code", "message" } }`; `GET /api/fs/list?path=../../../etc` answers `403 OUTSIDE_ROOT`; absolute paths answer `400 INVALID_PATH`; a request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` answers `403 FORBIDDEN_HOST`; non-GET/HEAD answers `405 METHOD_NOT_ALLOWED`.

From the client (T019–T036), behaviour defined by the spec and relied upon here:

- Views `explorer` → `config` → `player`; the explorer opens at the jail root (`GET /api/fs/root`) or at `slydr.explorer.lastPath`; **double-click** on a folder navigates into it; the footer button is **"Select this folder"**; the configuration screen has the back link **"Back to file explorer"**, the primary button **"Play slide show"**, the text "**N images found**", "No playable images in this folder." when `N` is 0, and a "Reset to defaults" link; its controls are "Duration for image shown" (range 1 to 30, default 5), and the checkboxes "Shuffle images", "Loop slide show", "Use animations and transitions", "Fill empty space on screen", "Start in full screen", "Include subfolders" (defaults on, on, on, on, on, off).
- Player aria-labels: "Previous image", "Pause slide show" / "Play slide show", "Next image", "Enter full screen" / "Exit full screen", "Stop slide show". Keys: `Space` play/pause, `Escape` stop, `←` previous, `→` next, `f` fullscreen. The controls overlay auto-hides after 2 s.
- The theme toggle is a button in the top right of the explorer and configuration screens, with `aria-label` "Switch to dark theme" or "Switch to light theme", and is absent in the player. `data-theme` on `<html>` mirrors the stored override only (absent while the user follows the OS). The blocking `<script src="/theme-init.js">` sets it before first paint (T021).
- `localStorage` keys (written debounced by 250 ms): `slydr.schemaVersion`, `slydr.theme`, `slydr.explorer.viewMode`, `slydr.explorer.showHidden`, `slydr.explorer.lastPath`, `slydr.config`.

**The UI contract between this suite and the client** is the name table in `tasks/README.md` (UI name contract). In particular the explorer view-mode control is a group of two buttons named "List view" and "Grid view" (`aria-pressed`), the show-hidden control is one button named "Show hidden items" (`aria-pressed`), the configuration screen's `<h1>` is the selected folder's name, and its only slider is named "Duration for image shown". All UI selectors live in one file, `e2e/support/ui.ts`, and follow this priority: (1) role plus accessible name from that table; (2) visible text; (3) the stable `data-testid` hooks below. The hooks are required because no accessible name distinguishes them, and each is a one-line attribute on an existing element. **T030 owns both hooks** (it adds them) and **T032 must keep `slide-current` on the `<img>` of the current layer** when it wraps the image; this ticket only verifies them and adds one only if it is missing:

| Hook | Element |
|---|---|
| `data-testid="player"` | root element of the player screen |
| `data-testid="slide-current"` | the `<img>` of the slide currently shown (not the blurred background layer, which carries `aria-hidden="true"`) |

The explorer controls are located by role and exact name (`getByRole('button', { name: 'Grid view' })`, `'List view'`, `'Show hidden items'`), written once in `ui.ts`, so a wording difference in the implemented labels is fixed in one place.

## 4. Implementation detail

### 4.1 Files and scripts

| File | Purpose |
|---|---|
| `playwright.config.ts` | Configuration (§4.2). |
| `e2e/support/start-server.mjs` | `webServer` launcher (§4.3). |
| `e2e/support/manifest.ts` | Loads `.fixtures/e2e/manifest.json` and re-exports the oracle functions. |
| `e2e/support/test.ts` | Extended `test` and `expect` (§4.4). |
| `e2e/support/ui.ts` | Locators and actions (§4.5). |
| `e2e/support/names.ts` | Pure helpers `escapeRe` and `nameRe`, re-exported by `ui.ts` (no Playwright import, so Vitest can test them). |
| `e2e/support/support.test.ts` | Vitest tests of the helpers (§6), run by T037's `tooling` Vitest project. |
| `e2e/tests/happy-path.e2e.ts`, `explorer-views.e2e.ts`, `theme.e2e.ts`, `security.e2e.ts`, `keyboard.e2e.ts`, `config-edge-cases.e2e.ts`, `responsive.e2e.ts`, `a11y.e2e.ts` | The tests (§4.6 and §6). |
| `e2e/tsconfig.json` | Extends `../tsconfig.base.json`; `noEmit`; `include: ["**/*.ts", "../playwright.config.ts"]`; `types: ["node", "@playwright/test"]`; `allowJs` and `checkJs` off. |

Root `package.json` (merge):

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "e2e:install": "playwright install chromium"
  },
  "devDependencies": { "@axe-core/playwright": "^4" }
}
```

`typecheck` is **appended to, not restated**: add ` && tsc --noEmit -p e2e/tsconfig.json` to the end of the existing value (T002's chain plus T037's ` && tsc --noEmit -p scripts/tsconfig.json`). Do not rewrite the earlier parts.

Other housekeeping:

- `.gitignore`: add `test-results/`, `playwright-report/`, `blob-report/` (`.fixtures/` was added by T037).
- Vitest: `npm test` must **not** pick up this suite. The files are named `*.e2e.ts`, which Vitest's default `include` (`*.test.*`, `*.spec.*`) does not match, and the root Vitest configuration additionally lists `e2e/tests/**` and `playwright.config.ts` in `exclude`. The harness unit tests under `e2e/support/` are the one exception: T037's `tooling` Vitest project already includes `e2e/support/**/*.test.ts`, so this ticket adds no Vitest configuration of its own (see section 6). Playwright's `testMatch` is `**/*.e2e.ts` for the same reason.
- ESLint: the `e2e/` directory is linted with the same flat config; ignore `test-results/`, `playwright-report/` and `.fixtures/`. Add the Playwright-recommended rule `no-floating-promises` (already part of the typescript-eslint strict set) and `no-wait-for-timeout` if `eslint-plugin-playwright` is already installed; do not add the plugin just for this.
- `npm run test:e2e` **does not build**. It requires `npm run build` to have run (the launcher checks and fails with a clear message). Developers run `npm run build && npm run test:e2e`; the `&&` there is typed interactively and works in cmd, PowerShell 7, bash and zsh, but is deliberately **not** put in an npm script (Windows PowerShell 5.1 does not support `&&`).
- Browsers: `npm run e2e:install` downloads Chromium into Playwright's per-user cache (`%LOCALAPPDATA%\ms-playwright` on Windows, `~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux). On Linux CI runners the dependencies must also be installed, which T040 does with `npx playwright install --with-deps chromium`; on Windows and macOS runners `playwright install chromium` suffices.

### 4.2 `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.SLYDR_E2E_PORT ?? 4417);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e/tests',
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/support/start-server.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
```

Rationale and decisions:

- **`127.0.0.1`, never `localhost`** (decision, not specified, with a platform reason). The server binds `127.0.0.1` only. Since Node 17 `localhost` may resolve to `::1` first, and on Windows and some Linux runners that produces a refused connection or a multi-second fallback. Every URL in the suite is built from `baseURL`.
- **Port `4417`** (decision): 100 above the default so a developer's running `npm run dev` (4317) or `npm start` does not collide with a test run. Override with `SLYDR_E2E_PORT` (read by both the config and the launcher). Port allocation across the repository: `4417` this suite, `4517` T039's `smoke:prod`, `4617` T040's CI check scripts (also listed in `tasks/README.md`).
- **CI-conditional settings are owned here.** `forbidOnly`, `retries` (`1` on CI), `workers`, `reporter` (list + HTML on CI), `trace: 'retain-on-failure'`, `screenshot` and `outputDir` are defined in this file and T040 does not edit it; T040 uploads `test-results/` and `playwright-report/` as artifacts.
- **Chromium only** on all three operating systems (owner decision); the spec's matrix is an OS matrix, not a browser matrix.
- **`reuseExistingServer: false`**: a stale server from a previous run would silently serve old data. If something already answers on the health URL, Playwright fails fast with "already used", which is the desired behaviour.
- **`fullyParallel: true`** is safe because no test writes to the fixture tree; the only server-side write is the thumbnail cache, which is atomic and idempotent (T014). Each test gets a fresh browser context, hence empty `localStorage`.
- **`workers: 2` on CI**: hosted runners have two cores; more workers only increase flake on Windows. Locally Playwright's default (half the cores) applies.
- **`timeout: 30_000`**: the slowest test (the play-through) takes about 6 s; the margin is for cold Windows runners. Assertions use the 7 s `expect` timeout instead of per-test sleeps.
- **`timezoneId`/`locale`** pinned so any date rendering and the collator-sensitive ordering are the same everywhere (the server's collator uses its own locale; the manifest oracle encodes the expected order).
- **`gracefulShutdown`** makes Playwright send `SIGTERM` and wait; on Windows Playwright terminates the process tree. The launcher runs the server in its own process (§4.3), so no orphan survives and no port stays bound.

### 4.3 `e2e/support/start-server.mjs`

This is the only entry the `webServer` runs. It prepares the data, then runs the built server **inside the same Node process** by importing `main` from the built entry and calling it, so there is no child process, no shell wrapper to kill, and no port left bound on Windows after a cancelled run.

```js
// Starts the production server against the generated fixture tree. Used by playwright.config.ts.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFixtureTree } from '../../scripts/fixtures.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const serverEntry = path.join(repo, 'server', 'dist', 'index.js');
const clientIndex = path.join(repo, 'client', 'dist', 'index.html');
const port = Number(process.env.SLYDR_E2E_PORT ?? 4417);

function fail(message) {
  console.error(`[e2e] ${message}`);
  process.exit(1);
}

if (!existsSync(serverEntry) || !existsSync(clientIndex)) {
  fail('Build output not found. Run "npm run build" before "npm run test:e2e".');
}

// The server retries PORT+1..+9 on EADDRINUSE; the tests cannot tolerate that, so check first.
await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', (err) => fail(`Port ${port} is not available (${err.code}). Stop the other process or set SLYDR_E2E_PORT.`));
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});

const base = path.join(repo, '.fixtures', 'e2e');
await mkdir(base, { recursive: true });
const manifest = await createFixtureTree(path.join(base, 'tree'));
await writeFile(path.join(base, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
await mkdir(path.join(base, 'cache'), { recursive: true });

Object.assign(process.env, {
  PORT: String(port),
  SLYDR_ROOT: manifest.rootDir,            // required: the temp/ .fixtures tree is not under the home directory
  SLYDR_CACHE_DIR: path.join(base, 'cache'),
  SLYDR_QUIET: '1',
  SLYDR_NO_OPEN: '1',
});

// T009 starts the server on import only when index.js is the process entry file. Here the entry is this
// launcher, so importing alone would start nothing: import `main` and call it explicitly.
const { main } = await import(pathToFileURL(serverEntry).href);
await main();
```

Notes on this file:

- The tree lives at `<repo>/.fixtures/e2e/tree` (git-ignored by T037), not in the OS temp directory. Reason: it is a stable, inspectable location after a failed run, avoids the macOS `/var` → `/private/var` and Windows 8.3 short-name path aliases (T037 returns the `realpath`ed `rootDir` in the manifest regardless), and the generator's marker check makes re-creation safe. Re-running wipes only a directory that carries `.slydr-fixture-root`.
- The probe closes its socket before the server starts; the window between the two is a few milliseconds and the failure mode (the server picks 4418) would be caught by the health check not matching, so no retry logic is added.
- The server logs a "SLYDR_ROOT is set" warning at startup; with `SLYDR_QUIET=1` it is suppressed. Remove `SLYDR_QUIET` locally to see the server's output when debugging (Playwright pipes it to the test runner output because `stdout: 'pipe'`).
- `SLYDR_ROOT` is documented as test-only (spec §3.1); this launcher is exactly that use.
- The launcher does not pass `--open` (`process.argv` has no such flag), so `openBrowser` (T039) is never reached; `SLYDR_NO_OPEN=1` is set as well.
- `main()` installs T009's SIGINT/SIGTERM shutdown handling, which is what lets Playwright's `gracefulShutdown` stop the process cleanly.
- `createFixtureTree` runs with default options (no `--large`, no `--scan-heavy`): the e2e suite needs the small tree, and generating about 22,000 extra files would slow every CI leg. Large-listing behaviour is covered by the API tests.

### 4.4 `e2e/support/manifest.ts` and `e2e/support/test.ts`

```ts
// e2e/support/manifest.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FixtureManifest } from '../../scripts/fixtures.mjs';
export { expectedListing, expectedImages } from '../../scripts/fixtures.mjs';
export type { FixtureManifest };

let cached: FixtureManifest | undefined;
export function loadManifest(): FixtureManifest {
  cached ??= JSON.parse(
    readFileSync(fileURLToPath(new URL('../../.fixtures/e2e/manifest.json', import.meta.url)), 'utf8'),
  ) as FixtureManifest;
  return cached;
}
/**
 * expectedImages(...) minus files the browser cannot decode: manifest.skipped entries with code 'AVIF_STUB'.
 * The "N images found" text still uses the unfiltered count (the server counts by extension).
 */
export function playablePaths(m: FixtureManifest, wirePath: string, opts: { recursive: boolean; showHidden: boolean }) {
  const stubs = new Set(m.skipped.filter((s) => s.code === 'AVIF_STUB').map((s) => s.path));
  const all = expectedImages(m, wirePath, opts);
  return { ...all, paths: all.paths.filter((p) => !stubs.has(p)) };
}
/** True when the generator could not create this link on this platform (e.g. unprivileged Windows). */
export const wasSkipped = (m: FixtureManifest, wirePath: string) => m.skipped.some((s) => s.path === wirePath);
```

```ts
// e2e/support/test.ts
import { test as base, expect } from '@playwright/test';
import { loadManifest, type FixtureManifest } from './manifest';

interface Options { allowedConsoleErrors: RegExp[] }
interface Fixtures { manifest: FixtureManifest; guard: void }

export const test = base.extend<Fixtures & Options>({
  allowedConsoleErrors: [[], { option: true }],
  manifest: async ({}, use) => { await use(loadManifest()); },

  // Runs for every test: fails it on any console error, uncaught page error or request to another origin.
  guard: [async ({ page, baseURL, allowedConsoleErrors }, use) => {
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !allowedConsoleErrors.some((re) => re.test(msg.text()))) {
        problems.push(`console.error: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('request', (req) => {
      const url = req.url();
      if (/^(data|blob|about):/.test(url)) return;
      if (new URL(url).origin !== origin) problems.push(`off-origin request: ${url}`);
    });
    await use();
    expect(problems, 'unexpected console errors, page errors or off-origin requests').toEqual([]);
  }, { auto: true }],
});
export { expect };
```

The guard is the browser half of NFR-9 (no outbound requests) and the practical half of the CSP check: a CSP violation is reported by Chromium as a console error, so a script, style or image blocked by `script-src 'self'` and friends fails the test that triggered it. Tests that deliberately cause errors opt out per file or per test with `test.use({ allowedConsoleErrors: [/pattern/] })`.

### 4.5 `e2e/support/ui.ts`

The only file that knows how the UI is addressed. Sketch (implement fully; names are fixed so the tests read the same everywhere):

```ts
import { expect, type Locator, type Page } from '@playwright/test';

import { nameRe } from './names';
export { nameRe };

export const gotoApp = (page: Page) => page.goto('/');

export const entryRegion = (page: Page) => page.getByRole('listbox').or(page.getByRole('grid'));
export const entry = (page: Page, name: string): Locator => entryRegion(page).getByText(nameRe(name));
export const openFolder = async (page: Page, name: string) => { await entry(page, name).dblclick(); };

export const gridViewButton = (page: Page) => page.getByRole('button', { name: 'Grid view' });
export const listViewButton = (page: Page) => page.getByRole('button', { name: 'List view' });
export const showHiddenToggle = (page: Page) => page.getByRole('button', { name: 'Show hidden items' }); // aria-pressed reflects state
export const selectThisFolder = (page: Page) => page.getByRole('button', { name: 'Select this folder' });
export const playButton = (page: Page) => page.getByRole('button', { name: 'Play slide show' });
export const backLink = (page: Page) => page.getByRole('link', { name: 'Back to file explorer' }).or(page.getByRole('button', { name: 'Back to file explorer' }));
export const themeToggle = (page: Page) => page.getByRole('button', { name: /^Switch to (dark|light) theme$/ });
export const player = (page: Page) => page.getByTestId('player');
export const currentSlide = (page: Page) => page.getByTestId('slide-current');
/** The wire path of the slide on screen, decoded from /api/image?path=… */
export async function currentSlidePath(page: Page): Promise<string | null> {
  const src = await currentSlide(page).getAttribute('src');
  return src ? new URL(src, page.url()).searchParams.get('path') : null;
}

export async function storage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/** 'dark' or 'light' from the painted page background, independent of how the theme was chosen. */
export async function effectiveTheme(page: Page): Promise<'dark' | 'light'> {
  return page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)!.map(Number);
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.4 ? 'dark' : 'light';
  });
}

/** Presses Tab until `target` has focus; fails with the sequence of focused elements. Keyboard-only navigation. */
export async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused({ timeout: 1_000 });
}
```

`e2e/support/names.ts` holds the pure part:

```ts
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a name in NFC or NFD, because macOS file systems may hand back either form (Café, été). */
export function nameRe(name: string): RegExp {
  const forms = new Set([name.normalize('NFC'), name.normalize('NFD')]);
  return new RegExp(`^(${[...forms].map(escapeRe).join('|')})$`);
}
```

Notes:

- Entry rows and tiles are found by their visible name text inside the listbox/grid region, not by a row role, because the spec fixes the region roles (`listbox` / `grid`, FR-14.8) but not the item roles. Double-clicking the text bubbles to the row's handler.
- `nameRe` is mandatory for `Café photos` and `été.jpg`: APFS preserves the composed or decomposed form used at creation, HFS+ volumes normalise to decomposed, and Linux and Windows keep what the generator wrote.
- `effectiveTheme` reads the painted result (the page background luminance) so the theme tests verify what the user sees rather than internal attributes; the attribute is asserted separately where the requirement is about the attribute (the override).
- The slide's path is decoded from the URL with `searchParams` so the test does not depend on how the client percent-encodes `/` in the `path` parameter.

### 4.6 Test files at a glance

| File | Spec §12.4 item | Tests |
|---|---|---|
| `happy-path.e2e.ts` | 1 | Launch → explorer → into `photos` → select → configure → play → slide advances → pause/next/previous → `Esc` → back on config. Fullscreen-rejection fallback. |
| `explorer-views.e2e.ts` | 2 | Grid thumbnails; list type icons; view mode, show-hidden and last folder survive a reload; failed thumbnail falls back to an icon. |
| `theme.e2e.ts` | 3 | OS dark respected on first load; OS light respected; toggle overrides and persists across reload; live OS change when no override; no flash (theme set before the app mounts). |
| `security.e2e.ts` | 4 | Crafted traversal returns `403 OUTSIDE_ROOT` and further hardening checks through the same origin. |
| `keyboard.e2e.ts` | 5 | Keyboard-only traversal of explorer, configuration and player with no pointer events. |
| `config-edge-cases.e2e.ts` | — | Zero-image state; include-subfolders recount and the depth cap; Reset to defaults; persisted configuration restored. |
| `responsive.e2e.ts` | — | 320 px and 1920 px widths: no horizontal page scroll, primary actions reachable. |
| `a11y.e2e.ts` | — | axe scan (WCAG 2.1 A/AA) of explorer, configuration and player in light and dark. |

Every test starts with `gotoApp(page)` on a fresh context (empty `localStorage`), and every test is independent of the others.

#### `happy-path.e2e.ts` (reference implementation)

```ts
import { test, expect } from '../support/test';
import { expectedImages, playablePaths } from '../support/manifest';
import * as ui from '../support/ui';

test('launch, pick a folder, configure, play, stop', async ({ page, manifest }) => {
  const t0 = Date.now();
  await ui.gotoApp(page);
  await expect(ui.entry(page, 'photos')).toBeVisible();
  test.info().annotations.push({ type: 'explorer-ready-ms', description: String(Date.now() - t0) }); // NFR-8, informational

  // Navigate into the fixture folder and select it.
  await ui.openFolder(page, 'photos');
  await expect(ui.entry(page, 'IMG_1.jpg')).toBeVisible();
  await ui.selectThisFolder(page).click();

  // Configuration screen shows the folder and the count from the oracle.
  // Files the browser cannot decode (a stub sample.avif, see T037) are skipped by the player (NFR-5), so exclude them.
  const { paths } = playablePaths(manifest, 'photos', { recursive: false, showHidden: false });
  await expect(page.getByRole('heading', { name: 'photos' })).toBeVisible();
  const found = expectedImages(manifest, 'photos', { recursive: false, showHidden: false }).paths.length; // by extension, unfiltered
  await expect(page.getByText(`${found} images found`)).toBeVisible();

  // Configure: 1 s per image, in order, no animation, no fullscreen.
  const slider = page.getByRole('slider', { name: /duration/i });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('1');
  await page.getByRole('checkbox', { name: /shuffle/i }).uncheck();
  await page.getByRole('checkbox', { name: /animations/i }).uncheck();
  await page.getByRole('checkbox', { name: /full screen/i }).uncheck();

  // Play.
  await ui.playButton(page).click();
  await expect(ui.player(page)).toBeVisible();
  await expect(ui.themeToggle(page)).toHaveCount(0); // never in the player
  await expect.poll(() => ui.currentSlidePath(page)).toBe(paths[0]);
  await expect.poll(() => ui.currentSlidePath(page), { timeout: 8_000 }).toBe(paths[1]); // auto-advance

  // Manual controls.
  await page.keyboard.press('Space');                          // pause
  const paused = await ui.currentSlidePath(page);
  await ui.player(page).getByRole('button', { name: 'Play slide show' }).waitFor(); // the pause button now offers "Play"
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => ui.currentSlidePath(page)).toBe(paths[(paths.indexOf(paused!) + 1) % paths.length]);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => ui.currentSlidePath(page)).toBe(paused);

  // Escape returns to the configuration screen (not in fullscreen, so the app receives the key).
  await page.keyboard.press('Escape');
  await expect(ui.player(page)).toHaveCount(0);
  await expect(ui.playButton(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'photos' })).toBeVisible();
});
```

The overlay's play/pause button and the configuration screen's primary button share the name "Play slide show" in different states, so locators for the overlay button are always scoped to `ui.player(page)`.

Further tests in this file:

- **Fullscreen request rejected falls back to fill-window.** `await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('denied')); })`; leave "Start in full screen" at its default (on); click Play; expect the player visible, `document.fullscreenElement` null, and `page.getByRole('alert')` with count 0 (no error dialog; spec FR-16.1).
- **Back to explorer retains the path.** Open `photos`, select, click "Back to file explorer"; expect `IMG_1.jpg` visible (still inside `photos`), not the root listing.

#### `explorer-views.e2e.ts`

1. **Grid shows thumbnails.** Open `photos`, switch to grid (`gridViewButton`, then expect it to have `aria-pressed="true"`). Start `page.waitForResponse(r => r.url().includes('/api/thumb') && r.url().includes('size=256') && r.status() === 200)` before the switch and await it. Then `expect.poll` over `page.locator('img[src*="/api/thumb"]').evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length)` to be greater than 0.
2. **List shows type icons.** Back in list view at the root, the row of a folder (`photos`), of an image (`UPPER.JPG`) and of a non-image file (`.hidden-file.txt` after enabling show-hidden, or `documents/notes.txt` after navigating) each contain an `svg` and no `img[src*="/api/thumb"]` (FR-14.2/14.3: list always uses icons).
3. **Both settings survive a reload.** Switch to grid; enable show-hidden; open `photos`. `expect.poll(() => ui.storage(page, 'slydr.explorer.viewMode')).toBe('grid')`, the same for `slydr.explorer.showHidden` (`'true'`) and `slydr.explorer.lastPath` (`'photos'`) **before** reloading (persistence is debounced by 250 ms; reloading earlier is a test race, not an app bug). `page.reload()`; expect the `grid` role region, the hidden photo `.hidden-photo.jpg` visible, and `IMG_1.jpg` visible (last folder restored).
4. **Hidden entries toggle.** At the root with show-hidden off, `.hidden-file.txt` has count 0; after enabling it, visible. On Windows only (`manifest.platform === 'win32'`), `desktop.ini` is hidden by default and appears with show-hidden on; elsewhere it is a normal visible file named `desktop.ini`. The expectation is derived from `expectedListing(manifest, '', showHidden)`: assert that every name in the oracle is present and that no extra names are present, comparing set equality of the region's entry names.
5. **Ordering.** In `photos` (list view), the order of image names read from the DOM equals `expectedListing(manifest, 'photos', false).map(e => e.name)` (this catches collation regressions: `IMG_2.jpg` before `IMG_10.jpg`).
6. **Unicode and spaces.** Open `Café photos`; `été.jpg` and `a b.png` are visible (through `nameRe`).
7. **Failed thumbnail falls back.** `test.use({ allowedConsoleErrors: [/Failed to load resource/] })` for this test only (Chromium logs the expected `500` of `corrupt.jpg` and `empty.png` as a console error). Open `edge-cases` in grid view; wait until `pixel.png`'s thumbnail has loaded; then assert no visible `<img>` in the grid region is both `complete` and `naturalWidth === 0` (a broken-image icon), and that the tile named `corrupt.jpg` is visible (it shows the image icon instead of a thumbnail; FR-14.9). `photo.heic` is listed as an ordinary file with no thumbnail request.
8. **Symlinks.** Skipped entirely with `test.skip(wasSkipped(manifest, 'links/inside-dir-link'), 'symlinks unavailable on this platform')`. Otherwise open `links`: `inside-dir-link` and `inside-file-link.jpg` are visible; `broken-link.jpg`, `escape-link` and `escape-file.jpg` are not (they are omitted by the server). Double-clicking `inside-dir-link` lists the contents of `photos`.

#### `theme.e2e.ts`

Each test sets its own `test.use({ colorScheme })`.

1. **OS dark on first load.** `colorScheme: 'dark'`, fresh context: `effectiveTheme` is `'dark'`; `html` has no `data-theme` attribute; the toggle's name is "Switch to light theme"; `localStorage['slydr.theme']` is `null`.
2. **OS light on first load.** Mirror image: `'light'`, toggle "Switch to dark theme".
3. **Toggle overrides and persists.** In dark OS mode click the toggle once: `html[data-theme="light"]`, `effectiveTheme` is `'light'`, the toggle's name is now "Switch to dark theme"; `expect.poll(storage 'slydr.theme')` is `'light'`; `page.reload()`: still light (the override wins over the OS in both directions). Click again: `data-theme="dark"`; poll storage `'dark'`; reload: dark.
4. **Live OS change while no override is stored.** Light OS; `await page.emulateMedia({ colorScheme: 'dark' })`; `expect.poll(() => ui.effectiveTheme(page)).toBe('dark')`. After the user has clicked the toggle (override stored), another `emulateMedia` change does **not** alter the theme.
5. **No flash of the wrong theme (T021, T039).** Seed the override before navigation: `await context.addInitScript(() => localStorage.setItem('slydr.theme', 'light'))` with `colorScheme: 'dark'`. Then `await page.route('**/assets/*.js', (route) => route.abort())` so the React bundle never runs, and `await page.goto('/', { waitUntil: 'domcontentloaded' })`. Assert `html[data-theme="light"]`, `effectiveTheme` is `'light'`, and `#root` is empty. This proves the blocking `/theme-init.js` ran under the production CSP and decided the theme before the app existed. `test.use({ allowedConsoleErrors: [/Failed to load resource|net::ERR_FAILED/] })` for this test, because aborting the bundle is logged as an error by design.
6. **Absent in the player.** Covered in the happy path; here assert the toggle is present on the configuration screen and absent in the player for the dark and light OS settings.
7. **Corrupt stored value.** `addInitScript` sets `localStorage['slydr.theme'] = 'purple'` and `slydr.config` to `'{not json'`; the app loads without a console error, follows the OS, and the configuration screen shows the defaults (spec §6.2: corrupt values degrade silently).

#### `security.e2e.ts`

Uses the `request` fixture (an `APIRequestContext` bound to `baseURL`), so the checks hit the production server directly, exactly as a script on the same machine would. Every response body is also checked to contain no absolute path (the `rootDir` and `outsideDir` strings from the manifest must not appear in any error body, spec §3.4).

| Request | Expected |
|---|---|
| `GET /api/fs/list?path=../../../etc` (the spec's example) | `403`, `error.code === 'OUTSIDE_ROOT'` |
| `GET /api/fs/list?path=%2e%2e%2f%2e%2e` (encoded) | `403` `OUTSIDE_ROOT` (the server decodes before validating) |
| `GET /api/fs/list?path=photos/../../..` | `403` `OUTSIDE_ROOT` |
| `GET /api/fs/list?path=/etc` | `400` `INVALID_PATH` |
| `GET /api/fs/list?path=C:\Windows` (URL-encoded) | `400` `INVALID_PATH` on every platform |
| `GET /api/fs/list?path=a%00b` | `400` `INVALID_PATH` |
| `GET /api/image?path=links/escape-file.jpg` | `403` `OUTSIDE_ROOT` — **skipped** when `wasSkipped(manifest, 'links/escape-file.jpg')` |
| `GET /api/fs/list?path=links/escape-link` | `403` `OUTSIDE_ROOT` — **skipped** when `wasSkipped(manifest, 'links/escape-link')` |
| `POST /api/fs/list` | `405` `METHOD_NOT_ALLOWED` |
| `GET /api/fs/list` with header `Host: evil.example` | `403` `FORBIDDEN_HOST` |
| `GET /` | `200`, `x-content-type-options: nosniff`, `content-security-policy` exactly equal to the spec string (§3.4) |
| `GET /does-not-exist` | `404`, body is not HTML |
| `GET /api/does-not-exist` | `404`, `error.code === 'NOT_FOUND'` |
| `GET /api/image?path=edge-cases/photo.heic` | `415` `UNSUPPORTED_IMAGE` |

Extra browser-level check: navigating the page to `/api/fs/list?path=../../../etc` shows the JSON error body and no directory content (assert the page text contains `OUTSIDE_ROOT`). The `Host: evil.example` request is sent with `node:http` (`http.request({ host: '127.0.0.1', port, path, headers: { Host: 'evil.example' } })`) from the start, through a small helper in `e2e/support/`, because fetch-style clients forbid or normalise a `Host` override; T040's runtime check does the same.

#### `keyboard.e2e.ts`

The test never calls `click`, `dblclick`, `hover` or `mouse.*`; the file begins with a comment saying so and an ESLint override forbids those calls (`no-restricted-syntax` on `page.mouse`, `.click(` and `.dblclick(` within this file).

1. Focus order: `tabTo` reaches, in order of appearance, the entry region, then the footer's "Select this folder". Each target must show a visible focus indicator: assert `outline-style` not `none` or a non-zero `box-shadow` (`--focus-ring`) via `evaluate`.
2. In the entry region press `ArrowDown` until the element referenced by `aria-activedescendant` has the text `photos` (maximum 20 presses; the oracle gives the index to compare against: `expectedListing(manifest, '', false)`); press `Enter`; expect `IMG_1.jpg` visible. Press `Backspace`; expect `photos` visible again at the root. Re-enter `photos` with `ArrowDown`/`Enter` as before, press `Alt+ArrowLeft`, and expect the root listing again. Re-enter `photos` a final time.
3. `tabTo(selectThisFolder)`, press `Enter`; the configuration screen appears and its heading is `photos`.
4. `tabTo` the duration slider; press `ArrowRight` twice from the default 5 and expect value 7; `PageDown` and expect 2 (spec §8.2: ±1 arrows, ±5 `PageUp`/`PageDown`); `Home` and expect 1.
5. `tabTo` the "Shuffle images" checkbox, press `Space`, expect it unchecked; `tabTo` "Start in full screen", `Space` to uncheck.
6. `tabTo(playButton)`, press `Enter`; the player is visible; press `ArrowRight` (slide changes), `Space` (paused; overlay stays), `Escape` (back on the configuration screen).
7. `tabTo(backLink)`, press `Enter`; the explorer is back inside `photos`.

#### `config-edge-cases.e2e.ts`

1. **Zero images.** Open `documents`, select. Expect the text "No playable images in this folder.", `ui.playButton(page)` disabled, a hint mentioning "Include subfolders", and a link back to the explorer.
2. **Include subfolders recount and the depth cap.** Open `deep`, select. Count with the oracle for `recursive: false` (1 image: `level-00.jpg`); check "Include subfolders"; expect the text `${n} images found` with `n = expectedImages(manifest, 'deep', { recursive: true, showHidden: false }).paths.length` (13 with the shipped constants, the 13th level boundary being the depth cap of 12). Uncheck: back to the flat count. Toggle twice quickly and assert the final text matches the final state (the stale response is aborted; spec §6.5).
3. **Persisted configuration is restored and validated.** `addInitScript` sets `slydr.schemaVersion` to `1` and `slydr.config` to `{"durationSeconds":99,"shuffle":false,"animations":false,"fillEmptySpace":true,"startFullScreen":false,"includeSubfolders":true}` (note: `loop` is deliberately missing); open `photos`, select; expect the slider value `30` (clamped from 99), "Shuffle images" unchecked, "Loop slide show" checked (a missing field takes the default `true`, spec §4.4), "Use animations and transitions" unchecked, "Start in full screen" unchecked, "Include subfolders" checked.
4. **Reset to defaults.** Change three controls, click "Reset to defaults", expect the defaults (5, on, on, on, on, on, off) and `expect.poll(storage 'slydr.config')` to parse to `DEFAULT_CONFIG`.
5. **Back keeps the explorer path.** Covered in the happy path; here verified for a nested path (`Café photos`).

#### `responsive.e2e.ts`

For viewports `{ width: 320, height: 640 }` and `{ width: 1920, height: 1080 }`: on the explorer and configuration screens, `document.documentElement.scrollWidth <= document.documentElement.clientWidth` (no horizontal page scroll), "Select this folder" and "Play slide show" are inside the viewport after scrolling into view, and each icon button in the header has a bounding box of at least 44 × 44 CSS pixels. At 320 px additionally open `Café photos` and assert the breadcrumb does not overflow the page (spec §7.3).

#### `a11y.e2e.ts`

Uses `@axe-core/playwright` (`new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()`). For `colorScheme` in `['light', 'dark']` (via `test.use`): scan (1) the explorer at the root in list view and again in grid view of `photos`, (2) the configuration screen for `photos`, (3) the player while playing with "Start in full screen" off and the overlay visible (a pointer move to reveal the controls is fine here; only `keyboard.e2e.ts` forbids pointer input). Assert `violations` is empty; on failure attach the violation ids and nodes to the test output. Real-browser axe also checks colour contrast against rendered colours, including the overlay over the fixture images. Defects found are fixed in the screen tickets or T036, not worked around here (no rule is disabled without a comment naming the reason).

## 5. Acceptance criteria

1. `npm run build` followed by `npm run test:e2e` passes on a developer machine running Windows 11, with Chromium installed by `npm run e2e:install`.
2. The suite passes without modification on macOS and Linux (verified in CI by T040, or locally if hardware is available). Tests that depend on symlinks or on Windows-only hidden names are skipped or adapted through the manifest, never failing because of the platform.
3. The webServer starts the **production** server (`server/dist/index.js` serving `client/dist`), not Vite; no test imports server code or talks to port 4317 or 5173.
4. Running `npm run test:e2e` before a build fails immediately with the message "Build output not found. Run "npm run build" before "npm run test:e2e"." and no browser starts.
5. With another process on port 4417, the run fails with the "Port 4417 is not available" message; setting `SLYDR_E2E_PORT` to a free port makes the run succeed.
6. After the run no `node` process from the launcher remains and port 4417 is free (check on Windows with `Get-NetTCPConnection -LocalPort 4417` returning nothing, on macOS and Linux with `lsof -i :4417`).
7. The five scenarios of spec §12.4 each have at least one test that passes, as mapped in §4.6.
8. Every test fails if the page logs a console error, throws an uncaught error or requests an origin other than `http://127.0.0.1:4417` (unless that test lists an explicit allow-list entry, and only the tests named in §4.6 do).
9. No test uses `waitForTimeout`, `force: true`, `page.mouse` (keyboard test) or `test.only`; `forbidOnly` is active in CI.
10. A deliberately broken build is caught: temporarily removing `<script src="/theme-init.js">` from `client/index.html` and rebuilding makes `theme.e2e.ts` test 5 fail; temporarily changing the `CSP` constant makes `security.e2e.ts` fail.
11. `npm test` (Vitest) executes no Playwright test file under `e2e/tests/` (it runs only the harness tests in `e2e/support/`), and `npm run typecheck` and `npm run lint` pass with the new files included.
12. Two consecutive runs on the same checkout both pass (the launcher re-creates the tree safely), and a run started from a different working directory with `npx playwright test -c <path>/playwright.config.ts` works.
13. On failure, `test-results/` contains a trace (after one retry on CI) and a screenshot, and `.fixtures/e2e/tree` remains for inspection.
14. The whole suite completes in under 3 minutes on a developer machine and under 6 minutes on a hosted CI runner (a budget, not a gate; investigate if exceeded).

## 6. Tests to write

The deliverable of this ticket is the test suite itself; §4.6 lists every test with its steps and assertions. In addition, write these tests of the harness in `e2e/support/support.test.ts` (Vitest, node environment). They need no browser, so the root Vitest configuration includes `e2e/support/**/*.test.ts` explicitly, while the Playwright files in `e2e/tests/` stay excluded. To keep the Vitest import graph free of `@playwright/test`, `nameRe` and `escapeRe` live in a dependency-free file `e2e/support/names.ts` that `ui.ts` re-exports.

1. `nameRe('Café photos')` matches both the composed (`'Caf\u00e9 photos'`) and decomposed (`'Cafe\u0301 photos'`) forms and rejects `'Cafe photos'`; it escapes regular-expression characters in names such as `a b.png` and `$RECYCLE.BIN` (a name containing `.` must not match an arbitrary character).
2. `loadManifest()` throws a readable error that mentions `npm run test:e2e` when the manifest file does not exist (wrap the read to produce that message).
3. `wasSkipped` returns true exactly for paths present in `manifest.skipped`.

Manual verification (record in the pull request):

- Run the suite once in headed mode (`npx playwright test --headed --workers=1`) on Windows 11 and watch the happy path and the keyboard test complete visibly.
- Run the verification in acceptance item 10 (break the theme script, break the CSP) and restore both.
- Run on a Windows account without Developer Mode (symlink creation refused): the suite must still pass, with the symlink tests reported as skipped.

## 7. Definition of done

- [ ] `playwright.config.ts`, `e2e/support/start-server.mjs`, `e2e/support/{manifest,test,ui}.ts` and the eight test files exist and match this ticket.
- [ ] `@axe-core/playwright` is a root devDependency and `a11y.e2e.ts` passes in light and dark.
- [ ] The `data-testid` hooks `player` and `slide-current` (owned by T030, kept by T032) exist in the client; no other `data-testid` was introduced without being listed in §3.
- [ ] Root scripts `test:e2e`, `test:e2e:ui`, `e2e:install` exist; none uses shell-specific syntax; `typecheck` includes `e2e/tsconfig.json`.
- [ ] `.gitignore`, ESLint and Vitest exclusions are in place; `npm test`, `npm run lint` and `npm run typecheck` pass.
- [ ] `npm run build && npm run test:e2e` passes on Windows 11 locally; criteria 4, 5, 6 and 10 of section 5 were exercised once by hand.
- [ ] The harness Vitest tests in section 6 pass.
- [ ] A short note in the pull request (not in `tasks/README.md`) lists the exact commands T040 must add to the workflow: `npm run build`, then `npx playwright install --with-deps chromium` on Linux and `npx playwright install chromium` on Windows and macOS, then `npm run test:e2e`, then upload `playwright-report/` and `test-results/` as artifacts on failure.
- [ ] Locator wording differences between the spec and the implemented client (if any) were absorbed in `e2e/support/ui.ts` and reported in the pull request, not worked around inside individual tests.

## 8. Notes and gotchas

- **Debounced persistence.** `localStorage` writes lag the UI by 250 ms (spec §6.2). Always `expect.poll` the stored value before `page.reload()`. A reload straight after a click is the most common cause of a flaky persistence test.
- **Why the production server and a blocking script matter for the theme test.** Vite's dev server transforms `index.html` and would hide a CSP regression. Only the production server proves that `script-src 'self'` still lets `/theme-init.js` run before first paint (T021, T039).
- **Native fullscreen is not asserted.** Headless Chromium grants `requestFullscreen` inconsistently across operating systems and CI display configurations, and the browser consumes `Escape` while in fullscreen (spec FR-16.10), so the end-to-end flow turns "Start in full screen" off and the dedicated test covers the rejection fallback. The player's component tests cover the `fullscreenchange` logic with a mocked document.
- **Timing.** The play-through uses the real 1 s minimum duration and `expect.poll` with an 8 s timeout, which is about eight times the interval, so a slow Windows runner has headroom. Do not shorten the poll timeout, and do not replace it with a fixed wait. Playwright's `page.clock` is deliberately not used: the app schedules with `setTimeout` against timestamps, and faking the clock would stop testing the real image decode that gates every advance.
- **Shuffle.** The tests that assert slide order turn "Shuffle images" off. With shuffle on, the order is random by design (`crypto.getRandomValues`), and the suite asserts only that a slide is shown and changes.
- **AVIF on constrained machines.** If `sharp` could not produce AVIF in the fixture generator, T037 falls back to a stub file; `sample.avif` then fails to thumbnail. No test depends on a thumbnail of any `sample.*` file other than the JPEGs; the count assertions use the oracle, which counts the file by extension.
- **Case-insensitive file systems.** Windows and default macOS volumes are case-insensitive; `UPPER.JPG` exists both at the root and in `photos/` and is only ever referenced by its exact manifest path. Do not add a fixture that differs from another only by case.
- **Antivirus on Windows.** Real-time scanning can slow the first start of the launcher (fixture creation plus server import) by several seconds. The 60 s `webServer.timeout` is intentional; do not lower it.
- **Parallel workers and the thumbnail cache.** Concurrent workers may request the same thumbnail; the server coalesces in-flight requests and renames atomically, so duplicate requests are safe. If a thumbnail test ever fails intermittently with `THUMBNAIL_FAILED` on a valid file, investigate the thumbnail service and its cache, not the test.
- **Browser binaries are not committed and not installed by `npm ci`.** A fresh clone needs `npm run e2e:install` once; the error Playwright prints without it ("Executable doesn't exist") is the expected symptom.
- **Do not point the suite at a developer's home directory.** `SLYDR_ROOT` is always the generated fixture tree. A test run must never read or thumbnail the real home folder.
- **Why `*.e2e.ts`.** It avoids Vitest's `*.spec.ts` default match and the confusion of two runners picking up the same file; do not rename the files to `.spec.ts`.

