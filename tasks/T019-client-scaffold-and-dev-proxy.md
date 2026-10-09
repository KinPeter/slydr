# T019 — Add the Vite config, dev proxy and app shell to the client workspace

**Epic:** E9
**Spec sections:** §2.1, §2.2, §2.3, §13.1, NFR-8, NFR-9
**Depends on:** T001, T002
**Estimated size:** M

---

## 1. Context

Slydr is a locally running, browser-based slide show application. It is made up of a local HTTP API (an Express 5 server bound to `127.0.0.1:4317` that reads the user's home directory) and a local single-page web UI with three screens: a file explorer, a slide show configuration screen, and a slide show player. T001 already created the `client/` npm workspace (manifest, tsconfig, a placeholder `main.tsx`) and T002 already wired its test and lint tooling. This ticket turns that skeleton into a runnable Vite 7 + React 19 single-page application and wires the development topology so the browser only ever talks to a single origin.

That single-origin property is the whole point of the dev proxy. During development there are two processes: the Vite dev server on port `5173` serving the UI with hot module replacement, and Express on port `4317` serving `/api/*`. Vite proxies every `/api` request through to Express, so from the browser's point of view there is exactly one origin and CORS never has to be enabled anywhere in the system (specification §2.2 and §3.4 both depend on this). In production the same single-origin property is achieved differently — Express itself serves the built `client/dist` directory — but that is a different ticket.

After this ticket the client renders a trivial placeholder page, builds to `client/dist`, and `npm run dev` from the repository root starts the shared compiler, the API and Vite, and opens the browser exactly once. Everything visual and stateful is built on top of this by later tickets.

## 2. Scope

### In scope

- **Add** to the existing `client/` workspace: `client/index.html`, `client/vite.config.ts`, `client/src/App.tsx`, `client/src/vite-env.d.ts` (only if it does not already exist), and **replace** the T001 placeholder `client/src/main.tsx`.
- Add the `dev`, `build` and `preview` scripts to `client/package.json`. No dependency or version in that file changes (T001 owns them).
- Configure the Vite dev server: `host: '127.0.0.1'`, `port: 5173`, `strictPort: true`, and a `/api` proxy targeting `http://127.0.0.1:4317`.
- Configure the production build to emit into `client/dist` with source maps and a minimal manual chunking strategy.
- `client/index.html` with the `<meta name="color-scheme" content="light dark">` tag required by §6.3 and a clearly marked, commented placeholder for the anti-FOUC theme script that T021 fills in.
- A minimal `client/src/App.tsx` that renders a heading and the result of a single `GET /api/health` call, proving the proxy works.
- Two small tweaks to the T002 client test config (§4.8) so CSS Modules resolve in later component tests.
- The root `package.json` scripts that orchestrate development (`dev`, `dev:shared`, `dev:server`, `dev:client`, `size:client`), the server workspace's `dev` script, and `scripts/check-client-size.mjs`.
- Browser auto-open exactly once, on the Vite side only.
- A documented, report-only bundle-size check against the NFR-8 target (`size:client`).
- Lint coverage for accessibility: install `eslint-plugin-jsx-a11y` at the root and enable it for `client/**` in the flat config (T002 installed only the React and React Hooks plugins).

### Out of scope

- Creating `client/package.json`, `client/tsconfig.json`, the dependencies, `client/vitest.config.ts` and `client/test/setup.ts` — **T001** and **T002** already did. This ticket only edits them as listed in §4.
- Design tokens, the base stylesheet, and the CSS Modules convention — **T020**.
- The theme hook, the actual anti-FOUC script body, and the theme toggle component — **T021** (this ticket only leaves the marked placeholder in `index.html`).
- The base component library (`Button`, `Slider`, `Breadcrumb`, …) — **T022**.
- The `localStorage` persistence layer — **T023**.
- `AppStateProvider` and the view state machine — **T024** (this ticket's `App.tsx` is a deliberately throwaway placeholder that T024 replaces).
- The typed API client in `client/src/api/client.ts` — **T025**. The health call in this ticket's `App.tsx` is a raw inline `fetch`, and T025 removes it.
- Production single-origin static hosting of `client/dist` from Express, the `npm start` script, and the CSP response headers — **T039**.
- The Express server itself and all `/api/*` endpoints — **T008–T018**.
- End-to-end (e2e) testing is out of scope.
- Using `@tanstack/react-virtual` — T001 already installed it; the explorer virtualization ticket (**T028**) is its first consumer. `lucide-react` is likewise installed and first used by T021/T022.

## 3. Prerequisites and assumed state

The repository contains the monorepo scaffold from **T001** and the tooling from **T002**. Do not recreate any of the following; edit only what §4 lists.

**From T001**

- Root `package.json`: `"workspaces": ["shared", "server", "client"]`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`, with `concurrently` and `tsx` as root devDependencies.
- `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, …).
- `client/package.json` — `@slydr/client`, private, ESM. Dependencies already present: `@slydr/shared` (`*`), `@tanstack/react-virtual`, `lucide-react`, `react` and `react-dom` (^19.1). DevDependencies already present: `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/react`, `@testing-library/user-event`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `jsdom` (^26.1.0), `vite` (^7.1.5). Its only script is `typecheck` (`tsc -p tsconfig.json --noEmit`).
- `client/tsconfig.json` — extends the base; `module: ESNext`, `moduleResolution: bundler`, `lib: [ES2023, DOM, DOM.Iterable]`, `types: ["vite/client"]`, `jsx: react-jsx`, `noEmit: true`, `include: ["src", "test", "vite.config.ts"]`. It already resolves `*.module.css` and `?url` style imports through `vite/client`.
- `client/src/main.tsx` — a placeholder that contains only `export {};`.
- `shared/` builds to `shared/dist` and is consumed through the workspace link.

**From T002**

- `client/vitest.config.ts` and `client/test/setup.ts`: `jsdom` environment, the `@vitejs/plugin-react` plugin, `@testing-library/jest-dom/vitest` matchers, an explicit RTL `cleanup()` in `afterEach`, tests in `client/test/**/*.test.{ts,tsx}`, registered as the `client` project of the root `vitest.config.ts`. **Vitest globals are off**: tests import `describe`, `it`, `expect`, `vi` from `'vitest'`, and no `vitest/globals` type is added anywhere.
- ESLint 9 flat config with `eslint-plugin-react` and `eslint-plugin-react-hooks` scoped to `client/**/*.{ts,tsx}`, Prettier, `typescript@^5.9.2`, `vitest@^3.2.4`.
- Real root scripts `build`, `test`, `typecheck`, `lint`, `format`. The root `build` already runs `npm run build -w @slydr/client --if-present`, so adding a client `build` script makes it take effect. The root `dev` is still a stub: `node scripts/not-implemented.mjs dev T019`.

**From T004–T007** (`@slydr/shared`, importable as `@slydr/shared`; not used by this ticket's code but listed for orientation):

```ts
export type EntryType = 'folder' | 'image' | 'file';
export interface FsEntry {
  name: string; path: string; type: EntryType; hidden: boolean;
  size: number | null; mtimeMs: number | null;
}
export interface ImageItem {
  name: string; path: string; dir: string;
  size: number | null; mtimeMs: number | null;
}
export interface HealthResponse { status: 'ok'; version: string }
export interface RootResponse { path: string; name: string; absoluteRoot: string; platform: string }
export interface ListResponse {
  path: string; name: string; parentPath: string | null;
  entries: FsEntry[];
  counts: { folders: number; images: number; files: number };
  truncated: boolean;
}
export interface ImagesResponse {
  path: string; recursive: boolean; count: number; truncated: boolean; items: ImageItem[];
}
export interface SlideshowConfig {
  durationSeconds: number; shuffle: boolean; loop: boolean; animations: boolean;
  fillEmptySpace: boolean; startFullScreen: boolean; includeSubfolders: boolean;
}
export const DEFAULT_CONFIG: SlideshowConfig;
export function parseConfig(input: unknown): SlideshowConfig;
```

The server workspace (**T008–T018**) serves `/api/health`, `/api/fs/root`, `/api/fs/list`, `/api/fs/images`, `/api/image` and `/api/thumb` on `127.0.0.1:4317`. It accepts `GET` and `HEAD` only, answers anything else with `405`, and returns every error as `{ "error": { "code": "...", "message": "..." } }`. The server may not exist yet when this ticket is implemented; the proxy must therefore tolerate a dead upstream without crashing Vite (see §8).

All paths that cross the API are POSIX-style, forward-slash, and relative to the jail root (`os.homedir()`); `""` denotes the jail root itself. The client never constructs or sees an absolute filesystem path, with the single exception of the display-only `absoluteRoot` string returned by `GET /api/fs/root`.

## 4. Implementation detail

### 4.1 `client/package.json` — scripts only

Add exactly these entries to the existing `scripts` object (keep `typecheck` as T001 wrote it). Do not touch `dependencies`, `devDependencies`, versions or any other field. There is deliberately no `test` script in the client package: tests run through the root `vitest run` (the `client` Vitest project from T002).

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173 --strictPort"
  }
}
```

### 4.2 `client/tsconfig.json` — no change expected

T001's tsconfig already has everything needed (`vite/client` types, `bundler` resolution, `jsx: react-jsx`, `include` covering `src`, `test` and `vite.config.ts`). **Do not add `vitest/globals` or any other Vitest type** — globals are off. Only if `tsc` complains that `vite.config.ts` cannot resolve a Node type (it should not, because the config below uses none) may `"node"` be added to `types`, as T001's note anticipates.

Add `client/src/vite-env.d.ts` only if it does not exist:

```ts
/// <reference types="vite/client" />
```

### 4.3 `client/vite.config.ts` (new)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev topology (spec §2.2): Vite serves the UI on 5173 and proxies every
 * /api request to the Express API on 127.0.0.1:4317. The browser therefore
 * only ever talks to one origin, which is why CORS is never enabled
 * anywhere in Slydr (spec §3.4).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: false, // the root `dev:client` script passes --open; see section 4.7
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
        ws: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    // Raw (uncompressed) kB per chunk. This only silences/raises Vite's own warning;
    // the NFR-8 gzip target is reported (not enforced) by `npm run size:client` (section 4.9).
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
```

Notes on the exact option values:

- There is no `root` option. The config file sits at the package root and Vite uses the config file's directory (when run with `npm run dev -w @slydr/client`, the working directory is the package). This avoids `__dirname`, which does not exist in an ESM config on every Vite code path, and keeps the file free of Node typings.
- `changeOrigin: false` is deliberate. The Express host guard (§3.4) accepts only `localhost`, `127.0.0.1`, or `[::1]`, optionally with a port. Vite's dev server already listens on `127.0.0.1`, so the forwarded `Host` header is `127.0.0.1:5173`, which passes the guard. Rewriting the origin is unnecessary and would make the guard harder to reason about.
- `ws: false` because no Slydr endpoint uses WebSockets. Vite's own HMR socket is served from its own path and is unaffected.
- `strictPort: true` on both server and preview: a silent fallback to port 5174 would break the single browser-open below. Failing loudly is better.
- `open: false`: the browser is opened once by the root `dev:client` script (§4.7), not by the config, so that a server restart under `tsx watch` never spawns a second tab.
- `chunkSizeWarningLimit: 300` is in raw kilobytes, a different measure from the gzipped NFR-8 budget. It is a convenience warning, not the budget check.
- Do **not** set `base`. The app is served from the origin root in both dev and production, and a non-default `base` would break the T039 static hosting.

**Decision (not specified):** `manualChunks` splits React into its own chunk. The specification states only the NFR-8 budget; a separate vendor chunk keeps the app chunk small and makes bundle-size regressions legible in the build output. Keep the chunk list minimal — one `react` chunk — rather than hand-partitioning the whole dependency graph.

### 4.4 `client/index.html` (new)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!--
      Spec §6.3: declares support for both colour schemes so native scrollbars,
      form controls and the browser's own UA styles follow the active theme.
    -->
    <meta name="color-scheme" content="light dark" />
    <title>Slydr</title>

    <!--
      ANTI-FOUC THEME SCRIPT PLACEHOLDER — owned by T021.
      T021 inserts here the code that resolves the effective theme
      (the stored `slydr.theme` value, else `matchMedia('(prefers-color-scheme: dark)')`)
      and sets `data-theme` on <html> BEFORE first paint, so the page never
      flashes the wrong theme. It must be compatible with the §3.4 CSP
      `script-src 'self'`; T021 records that decision.
      Do not add theme logic to main.tsx — by the time React mounts it is too late.
    -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

The placeholder must be a real HTML comment at exactly this position — inside `<head>`, after the `color-scheme` meta and before the module script — so T021 is a drop-in replacement with no reordering. Do not add a `<noscript>` block; the app is useless without JavaScript and a message adds nothing for a locally launched developer tool.

### 4.5 `client/src/main.tsx` (replaces the T001 placeholder)

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Slydr: #root container missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

T020 adds the `import './styles/tokens.css'` and `import './styles/base.css'` lines to this file; leave it free of style imports for now.

`StrictMode` is kept on permanently. It double-invokes effects in development, which is exactly the pressure the later player and persistence tickets need (double-fired timers and duplicated fetches are bugs, not noise).

### 4.6 `client/src/App.tsx` (new)

A deliberately minimal placeholder whose only job is to prove that the proxy carries a real request through to Express. T024 replaces this file entirely.

```tsx
import { useEffect, useState } from 'react';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; version: string }
  | { kind: 'error' };

/**
 * Placeholder shell — replaced by the view state machine in T024.
 * The raw fetch below is replaced by the typed API client in T025.
 */
export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { status: string; version: string }) => {
        setHealth({ kind: 'ok', version: body.version });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHealth({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Slydr</h1>
      <p data-testid="api-status">
        {health.kind === 'loading' && 'Checking the local API…'}
        {health.kind === 'ok' && `API reachable (version ${health.version})`}
        {health.kind === 'error' && 'Local API not reachable.'}
      </p>
    </main>
  );
}
```

### 4.7 Root and server scripts

Edit the **root** `package.json`. T002 made `build`, `test`, `typecheck`, `lint` and `format` real; this ticket **only replaces the `dev` stub and adds the `dev:*` and `size:client` scripts**, and must leave T002's scripts exactly as they are, because they build `shared` first and include the tooling-config typecheck:

```json
{
  "scripts": {
    "dev": "concurrently --kill-others --names \"shared,api,web\" --prefix-colors \"yellow,cyan,magenta\" \"npm:dev:shared\" \"npm:dev:server\" \"npm:dev:client\"",
    "dev:shared": "tsc -p shared/tsconfig.build.json --watch --preserveWatchOutput",
    "dev:server": "npm run dev --workspace @slydr/server",
    "dev:client": "npm run dev --workspace @slydr/client -- --open",
    "size:client": "node scripts/check-client-size.mjs"
  }
}
```

(`concurrently` and `tsx` are already root devDependencies from T001; do not re-add or change their versions.)

`dev:shared` is required: server and client consume `@slydr/shared` through `shared/dist` (T001 §4.5), so without a watching compile, edits to `shared/src` never reach the running API or the Vite app. Run `npm run build -w @slydr/shared` once before the first `dev` so `shared/dist` exists when the other two processes start.

This ticket adds the server workspace's `dev` script itself, in `server/package.json`: `"dev": "tsx watch src/index.ts"` (T039 later adds `start`/`build` beside it). Without it `dev:server` fails with "Missing script: dev", because no earlier ticket creates that script. If `server/src/index.ts` is still the T001 placeholder, `dev:server` exits immediately and `--kill-others` stops the rest, so verify `dev:client` alone until T009 lands; the composed `dev` is fully green after T009.

**Opening the browser exactly once.** The `--open` flag is passed to Vite through the root `dev:client` script, not set in `vite.config.ts`. Vite opens the browser once when the dev server first becomes ready and never again on an HMR update or a config reload. `tsx watch` restarting the Express process does not involve Vite at all, so a server restart cannot cause a second tab. Do not add any other open mechanism (no `open` package call in the server's dev path, no `concurrently` pre-step); duplicated tabs on every save is the failure mode this arrangement exists to prevent.

`--kill-others` ensures that if one process dies the others are torn down too, so `Ctrl+C` leaves nothing orphaned and a crashed API does not leave a zombie Vite holding port 5173.

### 4.8 Test configuration — two small tweaks to T002's files

`client/vitest.config.ts` and `client/test/setup.ts` **already exist from T002**. Do not recreate or overwrite them. Make only these changes:

- Leave `globals` off (tests import `describe`/`it`/`expect`/`vi` from `'vitest'`) and keep the `include` pattern `test/**/*.test.{ts,tsx}`.
- Replace T002's `css: { modules: { classNameStrategy: 'non-scoped' } }` with `css: { include: /.+/, modules: { classNameStrategy: 'non-scoped' } }` so that CSS files are actually processed. Later tickets use CSS Modules; without `include`, Vitest stubs CSS and the imported `styles` object is empty, which makes every `className` assertion fail.
- Optionally switch to `mergeConfig(viteConfig, ...)` so the test run shares the resolve and plugin settings of `client/vite.config.ts`, as long as the T002 settings above are kept.
- `client/test/setup.ts` stays as T002 wrote it; do not replace it with a one-line import, or the RTL cleanup is lost and rendered trees leak between tests.

### 4.9 Bundle-size budget (NFR-8)

NFR-8 sets a **target of 300 KB gzipped** for the client bundle, excluding images. The app runs locally, so the target is reported, not enforced: the check never fails a build or CI. Make it visible rather than aspirational:

1. `chunkSizeWarningLimit: 300` in the build config surfaces a (raw-size) warning in the normal build output — an early hint only.
2. The root script `size:client` (§4.7) reports the real gzipped total after a build and prints a warning when it is above the target. Create `scripts/check-client-size.mjs` (linted with Node globals by T002's `scripts/**/*.mjs` rule). It always exits `0` once `client/dist/assets` was readable:

```js
// scripts/check-client-size.mjs
import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const TARGET_BYTES = 300 * 1024; // NFR-8 target, reported only
const assetsDir = join(process.cwd(), 'client', 'dist', 'assets');

let total = 0;
for (const name of await readdir(assetsDir)) {
  if (!/\.(js|css)$/.test(name)) continue; // images and source maps excluded per NFR-8
  const file = join(assetsDir, name);
  if (!(await stat(file)).isFile()) continue;
  const gz = gzipSync(await readFile(file)).byteLength;
  total += gz;
  console.log(`${name}: ${(gz / 1024).toFixed(1)} kB gz`);
}

console.log(`total: ${(total / 1024).toFixed(1)} kB gz (target ${TARGET_BYTES / 1024} kB)`);
if (total > TARGET_BYTES) {
  console.warn('NFR-8 target exceeded: client bundle is above 300 kB gzipped (informational, not a failure).');
}
```

**Decision (not specified):** the size is measured as the gzipped sum of all emitted `.js` and `.css` assets in `client/dist/assets`, excluding images and source maps. The specification states the number but not the measurement method; summing JS + CSS is the conservative reading and the one that keeps the check honest as chunks are added.

At the end of this ticket the figure should be roughly 50–60 kB gzipped (React 19 plus a few lines of app code). Later tickets add `lucide-react` (tree-shaken) and `@tanstack/react-virtual` usage, and T039's pipeline also runs this script.

### 4.10 Lint coverage: accessibility rules

T002 already lints `client/**/*.{ts,tsx}` with `eslint-plugin-react` and `eslint-plugin-react-hooks`. It does **not** install `jsx-a11y`, whose rules carry real weight for NFR-6 in later tickets. Add it to the existing root flat config rather than creating a second config inside `client/`:

1. `npm install -D eslint-plugin-jsx-a11y@^6.10 -w .` (root devDependency).
2. In `eslint.config.js`, add `import jsxA11y from 'eslint-plugin-jsx-a11y';` and, directly after T002's client entries and before the Node-tooling entry:

```js
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['client/**/*.{ts,tsx}'],
  },
```

Confirm `npm run lint` is clean on the new files (for example the `<main>`/`<h1>` placeholder has no a11y violations).

## 5. Acceptance criteria

- [ ] `client/package.json` still declares every dependency and version T001 set (including `@tanstack/react-virtual`, `lucide-react`) and now has `dev`, `build`, `preview` scripts besides `typecheck`; no dependency was added, removed or re-versioned.
- [ ] `client/tsconfig.json` has no `vitest/globals` entry, and `client/vitest.config.ts` still has `globals` unset.
- [ ] `npm ls --workspace @slydr/client` resolves `@slydr/shared` to the local `shared/` directory, not a registry package.
- [ ] `client/vite.config.ts` sets `server.port` to `5173`, `server.strictPort` to `true`, `server.host` to `'127.0.0.1'`, a `server.proxy` entry for `'/api'` targeting `http://127.0.0.1:4317`, and has no `root` or `base` option.
- [ ] `client/index.html` contains `<meta name="color-scheme" content="light dark">` and an HTML comment inside `<head>` that explicitly names T021 as the owner of the anti-FOUC theme script.
- [ ] `npm run dev:client` starts Vite on `http://127.0.0.1:5173` and opens the default browser exactly once; saving a source file triggers HMR without opening a second tab.
- [ ] With the Express API running on `4317`, loading `http://127.0.0.1:5173` shows "API reachable (version …)"; `curl http://127.0.0.1:5173/api/health` returns the same JSON body as `curl http://127.0.0.1:4317/api/health`.
- [ ] No `Access-Control-Allow-Origin` header appears on any response and no CORS middleware exists anywhere in the repository.
- [ ] With the API **stopped**, loading the page shows "Local API not reachable." and the Vite dev server keeps running (it logs a proxy error and does not exit).
- [ ] `npm run build --workspace @slydr/client` writes `client/dist/index.html` plus hashed assets under `client/dist/assets/`, and emits source maps.
- [ ] `npm run size:client` prints the gzipped total and exits `0` (it only warns above the 300 KB target), with the total comfortably under 300 KB.
- [ ] `npm run dev` from the repository root starts the shared compiler, the API and the web process with distinguishable `shared` / `api` / `web` log prefixes, and `Ctrl+C` terminates all of them.
- [ ] `npm run typecheck` reports no errors for the client workspace under TypeScript strict mode.
- [ ] `npm run lint` reports no errors for `client/**`, and a deliberate a11y violation in a client component (for example `<img>` without `alt`) is reported by `jsx-a11y`.
- [ ] `npm test` runs the client suite in the `jsdom` environment and the tests of this ticket pass.

## 6. Tests to write

Per specification §12.3 (component tests with React Testing Library in the `jsdom` environment). All tests live under `client/test/` (Vitest only discovers `test/**/*.test.{ts,tsx}`) and import `describe`, `it`, `expect`, `vi` from `'vitest'`.

### `client/test/App.test.tsx`

```
describe('App (scaffold shell)')
  it('renders the Slydr heading')
  it('shows "Checking the local API…" before the health request resolves')
  it('shows the version from /api/health once the request resolves')
  it('shows "Local API not reachable." when the health request rejects')
  it('aborts the in-flight health request on unmount without logging an unhandled rejection')
```

Stub `globalThis.fetch` with `vi.fn()` per case (`vi.stubGlobal`; T002 unstubs automatically); assert the request URL is exactly `/api/health` (a relative, same-origin URL — never an absolute `http://127.0.0.1:4317/...`), which is what proves the client relies on the proxy rather than a base URL.

### `client/test/scaffold.test.ts`

```
describe('client scaffold')
  it('index.html declares <meta name="color-scheme" content="light dark">')
  it('index.html reserves the anti-FOUC theme script placeholder in <head>')
  it('index.html loads /src/main.tsx as a module script')
  it('the T001 dependencies and the T002 test settings were left intact')
```

Read `client/index.html` and `client/package.json` from disk with `node:fs` and assert on their contents. These are cheap regression guards: the `color-scheme` meta and the placeholder position are both load-bearing for T021, and silently losing either produces a visible theme flash that no component test would catch. The last case asserts `@tanstack/react-virtual` and `lucide-react` are still dependencies and that `vitest/globals` appears in neither `tsconfig.json` nor the Vitest config.

### `client/test/vite-config.test.ts`

```
describe('vite config')
  it('serves the dev server on 127.0.0.1:5173 with strictPort')
  it('proxies /api to http://127.0.0.1:4317')
  it('builds into the dist directory with sourcemaps enabled')
  it('does not set a non-root base path')
```

Import the default export from `../vite.config` and assert on the resolved object. If the export is a function form, call it with `{ command: 'serve', mode: 'development' }`.

### Proxy verification (manual, recorded in the ticket's verification notes)

Proxy verification is manual here — a real proxy check needs two live processes. Verify manually with `curl http://127.0.0.1:5173/api/health` while both processes run, and note the result in the pull request. End-to-end (e2e) testing is out of scope.

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] `npm run dev` starts all three processes, proxies `/api` correctly, and opens the browser exactly once.
- [ ] `npm run build --workspace @slydr/client` succeeds and `npm run size:client` reports a gzipped total under the 300 KB NFR-8 target.
- [ ] `client/index.html` carries the `color-scheme` meta tag and the T021 placeholder comment.
- [ ] The client test environment is `jsdom` with `@testing-library/jest-dom` matchers registered, verified by a passing component test.
- [ ] No CORS configuration was added to either workspace.
- [ ] README: no change; T041 creates the README and should cover the development topology (Vite 5173 proxying `/api` to Express 4317), `npm run dev`, and the note that production serving is single-origin via Express.

## 8. Notes and gotchas

- **This ticket edits, it does not scaffold.** T001 and T002 own the manifest, tsconfig, dependencies and test setup. If a snippet in this ticket seems to contradict them, the earlier ticket wins for versions and dependencies; this ticket only adds the listed scripts, files and config tweaks.
- **The proxy is a security feature, not just convenience.** Because dev traffic is single-origin, §3.4's "do not enable CORS" rule holds in every environment. If anyone later reaches for `cors()` on the server, the correct fix is almost always a missing proxy rule here.
- **A dead upstream must not kill Vite.** When Express is not running, Vite's proxy logs `ECONNREFUSED` and returns a 500 for that request. This is acceptable and expected during development (the client frequently starts before the server finishes booting). Do not add a custom `configure` handler that rethrows; and do not add a retry loop. The placeholder `App.tsx` already degrades to "Local API not reachable."
- **Port 4317 is an arbitrary pick** (specification §16.2 item 1). The server tries `PORT` then `+1` up to `+9` if the preferred port is busy. The dev proxy, however, targets `4317` as a literal. If the server falls back to 4318 the proxy breaks with a confusing `ECONNREFUSED`. Treat that as a known development wrinkle: free the port rather than making the proxy target dynamic. **Decision (not specified):** the proxy target stays a hard-coded literal, because a dynamic target would require a handshake between two independent processes for a case that only occurs when something else is already squatting the port.
- **`strictPort`.** Keeping `strictPort: true` means a port conflict fails fast with a clear message instead of silently serving on the wrong port.
- **Do not put the theme logic in `main.tsx`.** React mounting happens after first paint, so a theme applied there produces exactly the flash of unstyled/mis-themed content that §6.3 requires be avoided. The placeholder comment in `index.html` says so; keep it.
- **`StrictMode` double-invocation.** Expect the health `fetch` to fire twice in development. The `AbortController` cleanup makes this harmless. Later tickets (the player's timers, the persistence layer's debounced writes) depend on this pressure being present, so do not remove `StrictMode` to quiet the console.
- **NFR-9 (no outbound requests).** Nothing in the client may contact anything other than the local API. That rules out Google Fonts links, CDN script tags, analytics, and remote source maps. `--font-ui` in T020 is therefore a system font stack, and no `<link>` to an external host may appear in `index.html`.
- **No router (§2.3, §16.1 A2).** Do not install `react-router` or wire the browser history. The three screens are driven by an in-app state machine (T024). This is a deliberate decision so the explorer's current path survives back-navigation.
- **T039 depends on the build output path.** Production serving reads `client/dist`. Do not change `build.outDir` or introduce a `base` prefix without coordinating with that ticket.
