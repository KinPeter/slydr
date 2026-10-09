# T039 — Serve the built client from the server and implement npm start

**Epic:** E23
**Spec sections:** §2.2, §3.4, §13.1, NFR-8, NFR-9
**Depends on:** T009, T019, T021
**Estimated size:** L

---

## 1. Context

During development Slydr runs as two processes (Vite on `5173` proxying `/api` to Express on `4317`). For real use, spec §2.2 requires a **single process**: Express serves the built client from `client/dist` as static files alongside `/api/*`, on the same origin, so the browser still talks to exactly one origin and CORS stays unnecessary. `npm start` must run that built server, print its URL (the port may have been bumped by the `+1..+9` retry) and open the default browser on Windows, macOS and Linux.

This ticket adds that production path: static hosting with correct caching and the §3.4 security headers (nosniff and the exact Content-Security-Policy on the HTML document), the 404 behaviour for unknown paths, the server build and start scripts that make `node server/dist/index.js` runnable from any working directory, a tiny dependency-free browser opener, and the NFR-8/NFR-9 checks (bundle size and startup time are reported against their targets but never fail a build; no outbound requests is asserted). The theme bootstrap script must keep executing before first paint under that CSP, which T021 already arranged; this ticket verifies it on the built output.

## 2. Scope

### In scope

- Static hosting of `client/dist` from the Express app factory, driven by a new optional `ServerConfig.clientDir` field (T008's `ServerConfig`) that `server/src/index.ts` sets after locating the directory from `import.meta.url`. `createApp(config, logger?, deps?)` keeps its signature.
- 404 behaviour: unknown `/api/*` → JSON `404 NOT_FOUND` envelope; unknown non-API paths → plain `404`; `/favicon.ico` → `204`.
- Cache headers (immutable for hashed Vite assets, `no-cache` for `index.html` and everything unhashed).
- `X-Content-Type-Options: nosniff` and the exact §3.4 CSP on the HTML document; method guard and Host check still applying to static routes; `HEAD` support; dotfile and traversal protection; no directory listings.
- The server build: `server` compiled to `server/dist` with `tsc` (`build` and `start` scripts in `server/package.json`), `@slydr/shared` resolvable at runtime from its built output, verified from a different working directory. The root `build` script stays as T002 defined it.
- `npm start`: prints the actual URL, opens the browser through `server/src/openBrowser.ts`; opt-outs `SLYDR_NO_OPEN`, `--no-open`, `NODE_ENV=test`. `SLYDR_NO_OPEN` is a new variable: specification §13.2 is amended with a row for it (the flags stay developer-only).
- NFR-8 reporting: `npm run check:bundle` (gzipped client size against the 300 KB target) and `npm run smoke:prod` (startup time against the 2 s target, cross-cwd run, header check). Both print figures and a warning above target; neither fails because of a size or time figure.
- NFR-9 verification: a test that the built HTML and CSS reference no external origin.
- Vitest tests (server project) against the app factory with a temporary `client/dist`-like directory, plus a test of the built `index.html`, plus unit tests for the opener.

### Out of scope

- The anti-FOUC script itself and the decision to ship it as a same-origin file — **T021** (restated here, not re-decided).
- The dev-mode browser opening via `vite --open` and `npm run dev` — **T019**; it must keep working unchanged.
- The Playwright `webServer` that starts this production server — **T038**.
- CI workflow changes (running the built-output tests, `check:bundle` and `smoke:prod` after the build step) — **T040**.
- README prose about install and run — **E25**; this ticket only adds the facts listed in the definition of done.
- The API routes, guards and error envelope themselves — **T008–T018**.

## 3. Prerequisites and assumed state

The monorepo (npm workspaces `shared/`, `server/`, `client/`, ESM, TypeScript strict, Node >= 22, Express 5, Vite 7 + React 19) exists from T001. In particular:

- **Server (T008–T018).** `server/src/app.ts` is an app factory that never calls `listen`; it installs, in this order, the `Host` check (`403 FORBIDDEN_HOST` unless `localhost`, `127.0.0.1` or `[::1]`, optional port), the method guard (`405 METHOD_NOT_ALLOWED` for anything but `GET`/`HEAD`), the `/api` routers, and the error-envelope middleware (`{ "error": { "code", "message" } }`, never leaking OS messages or absolute paths). `ApiError` carries a code and HTTP status. `server/src/index.ts` resolves and validates the jail root, binds strictly `127.0.0.1`, uses `PORT` (default `4317`) retrying `+1..+9` on `EADDRINUSE`, and logs structured single-line records honouring `SLYDR_QUIET`. Env vars: `PORT`, `SLYDR_ROOT` (test-only), `SLYDR_CACHE_DIR`, `SLYDR_CACHE_MAX_MB` (default `500`), `SLYDR_QUIET`.
- **Client (T019, T021).** `client` builds with `vite build` into `client/dist` (`index.html`, hashed files under `client/dist/assets/`, source maps, no `base`). `client/public/theme-init.js` is copied verbatim to `client/dist/theme-init.js`. `client/index.html` contains `<meta name="color-scheme" content="light dark">` and, after it, `<script src="/theme-init.js"></script>`. The root scripts include T002's `typecheck` (builds `shared` first, so a clean checkout type-checks) and `build` (typecheck, then build `shared`, `server` and `client`), which this ticket does not change; `"size:client": "node scripts/check-client-size.mjs"` (gzips `client/dist/assets/*.js|css`, prints the total and warns above 300 KB, always exits `0`), and `dev`/`dev:server`/`dev:client` (the latter passes `--open` to Vite; the server's own dev script is `tsx watch src/index.ts`).
- **Server entry (T009).** `server/src/index.ts` exports `main()` and `BIND_HOST`, starts `main()` only when it is the entry file, and already installs `SIGINT`/`SIGTERM` handling through `installShutdown` (graceful close, exit `0`). T038's launcher imports and calls `main()` itself.
- **The CSP/inline-script decision recorded in T021 (binding for this ticket).** The pre-paint theme script is a separate same-origin classic file loaded with a parser-blocking `<script src="/theme-init.js"></script>` in `<head>`. It satisfies `script-src 'self'` with **no hash, no nonce and no `'unsafe-inline'`**. This ticket therefore must **not** narrow `script-src` below `'self'` and must **not** compute or append any hash. Neither `defer`, `async` nor `type="module"` may appear on that tag.
- **Env table.** This ticket adds one variable, `SLYDR_NO_OPEN` (see §4.7), to the server's documented env vars (`server/src/config/env.ts` and the README configuration table).

Express 5 note: the router uses `path-to-regexp` v8, so a bare `*` route pattern is invalid. Use `app.use('/api', handler)` prefix mounting, never `app.get('*', ...)`.

## 4. Implementation detail

### 4.1 Decisions made in this ticket

| # | Decision (not specified) | Choice |
|---|---|---|
| 1 | Locating `client/dist` | From `import.meta.url`: `fileURLToPath(new URL('../../client/dist', import.meta.url))`. Valid for both `server/src/index.ts` (tsx) and `server/dist/index.js` (compiled), which sit at the same depth. Never `process.cwd()`. **No environment override**: `ServerConfig.clientDir` is how `index.ts` passes it and how tests inject a fixture directory; adding a user-facing variable would only widen the attack and support surface. |
| 2 | SPA fallback | **None.** The app has no router and no deep links (spec §2.3 and §16.1 A2; §3.4 does not mention a fallback), so unknown non-API paths return `404 text/plain`, not `index.html`. A reload of `/` is the only reload that exists. |
| 3 | Unknown `/api/*` | JSON `404` with `{ "error": { "code": "NOT_FOUND", "message": "Unknown API endpoint." } }`, never HTML. |
| 4 | Missing `client/dist` | If the directory has no `index.html`: serve API only and log one warning (this is the normal state under `tsx watch` in development). If the process was started with `--open` (i.e. through `npm start`), exit `1` with `Client build not found at <dir>. Run "npm run build" first.` |
| 5 | Auto-open trigger | Opt-**in** by the start script: only `npm start` passes `--open`. `tsx watch` (dev), Playwright and tests never pass it, so they cannot spawn a browser by accident. Disabled even with `--open` by `--no-open`, by `SLYDR_NO_OPEN` set to `1` or `true`, or by `NODE_ENV=test`. |
| 6 | Browser opener | Own helper `server/src/openBrowser.ts` on `child_process.spawn`, not the `open` package (comparison in §4.7). |
| 7 | Banner | `Slydr is running at http://127.0.0.1:<port>` printed to stdout after a successful bind, honouring `SLYDR_QUIET` (consistent with "quiet suppresses non-error logs"). |
| 8 | Setting `NODE_ENV` | Not used to select production mode: `NODE_ENV=production node ...` is shell-specific syntax and fails in Windows `cmd`/PowerShell. Production behaviour is determined by the presence of `client/dist` and by the `--open` flag. (The server only *reads* `NODE_ENV=test`, which Vitest sets, as an opt-out from opening a browser.) |
| 9 | Where `clientDir` lives | `ServerConfig.clientDir?: string`, not a new `createApp` parameter. `readServerConfig()` leaves it unset; `index.ts` sets it when `client/dist/index.html` exists. `makeTestConfig()` leaves it unset, so every existing API test keeps its behaviour; static tests pass `makeTestConfig({ clientDir })`. |

### 4.2 App factory changes: `server/src/app.ts`

`createApp(config: ServerConfig, logger?: Logger, deps?: AppDeps)` (T008/T009/T017) keeps its signature. Add one optional field to `ServerConfig` in `server/src/config/env.ts`:

```ts
export interface ServerConfig {
  // ...existing fields...
  /** Absolute path of the built client (contains index.html). Unset = serve the API only. */
  clientDir?: string;
}
```

`readServerConfig()` never sets it from the environment; `index.ts` sets it (§4.6). `createApp` reads `config.clientDir`. T008 reserved the insertion point for this layer (after the `/api` routers, before the error envelope).

Middleware order inside `createApp` is part of the contract:

1. Host check (existing, global — applies to static routes too).
2. Method guard (existing, global — `POST /` must answer `405`, not fall through).
3. `/api` routers (existing).
4. `app.use('/api', (_req, _res, next) => next(new ApiError('NOT_FOUND', 404, 'Unknown API endpoint.')))` — so every unknown API path ends in the JSON envelope. If T008 already installed an equivalent scoped fallthrough, keep one copy.
5. When `config.clientDir` is set: `GET /favicon.ico` → `204` with no body (avoids a console 404 in every browser; the app ships no favicon asset).
6. When `config.clientDir` is set: the static layer of §4.3.
7. When `config.clientDir` is set: final non-API handler → `404`, `Content-Type: text/plain; charset=utf-8`, body `Not found`, plus `X-Content-Type-Options: nosniff`.
8. Error-envelope middleware (existing, last).

When `config.clientDir` is unset, steps 5–7 are skipped: every existing API test keeps its behaviour, and `GET /` gives Express's default 404.

### 4.3 Static layer

```ts
import express from 'express';
import path from 'node:path';

const clientDir = config.clientDir; // narrowed non-undefined inside the `if (config.clientDir)` block
const HASHED_ASSET = /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

app.use(
  express.static(clientDir, {
    dotfiles: 'ignore',   // /.env, /.git, /assets/.x -> treated as absent -> 404
    index: 'index.html',  // GET / serves index.html; sub-directories without one -> 404
    redirect: false,      // no 301 from /assets to /assets/; no directory probing
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      const rel = path.relative(clientDir, filePath).split(path.sep).join('/');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (HASHED_ASSET.test(rel)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
      if (rel === 'index.html') {
        res.setHeader('Content-Security-Policy', CSP);
      }
    },
  }),
);
```

with the policy string copied exactly from spec §3.4:

```ts
export const CSP =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'";
```

Notes:

- `express.static` handles `HEAD` natively (same headers, no body), `If-None-Match` → `304`, and `Range`. Directory listings are not a feature of `express.static`; with `redirect: false` and no `index.html` in `assets/`, `/assets` and `/assets/` both end up at the final `404`.
- Vite's default file names are `assets/[name]-[hash].js|css` with an 8-character base64url hash; `HASHED_ASSET` requires the `assets/` prefix and a `-<8+ chars>` suffix. Everything else — `index.html`, `theme-init.js`, any other unhashed file — is `no-cache` (revalidated by ETag, so a warm reload is a cheap `304`). **Decision (not specified):** source maps are served (local developer tool, harmless) and cached like their hashed siblings; they are excluded from the bundle size figure.
- `theme-init.js` is deliberately `no-cache`, not immutable: its name is not content-hashed, so an immutable header would leave users on a stale script after an upgrade.
- The CSP is attached to the HTML document only (`index.html`, reached via `/` or `/index.html`), exactly as spec §3.4 words it. `nosniff` is attached to every response of the static layer and of the final 404.
- With this exact CSP: `connect-src` is not listed, so it falls back to `default-src 'self'`, and same-origin `fetch('/api/...')` works while any request to another origin is blocked by the browser. This is the enforcement half of NFR-9. `img-src` allows `blob:` and `data:` for the player. Fonts fall back to `'self'`, which is why fonts and icons must be bundled.
- `path.relative(...).split(path.sep).join('/')` keeps the regex match correct on Windows, where `filePath` has backslashes.

### 4.4 CSP compatibility of the theme script, and how to verify it

Restating the T021 outcome in operational terms: the HTML in `client/dist/index.html` must satisfy all of the following, and a test (§6) asserts them on the real build output:

1. It contains `<script src="/theme-init.js"></script>` with no `defer`, `async` or `type` attribute.
2. That tag appears **before** the Vite-injected `<script type="module" crossorigin src="/assets/index-….js">` tag. Module scripts are deferred, so the classic blocking script necessarily runs first as long as it stays in `<head>`; the assertion guards against Vite or a future plugin moving it.
3. The document contains no **inline** `<script>` (a `<script>` element without `src` and with non-whitespace content). Under `script-src 'self'` such a script would be blocked and the failure would be silent apart from a console message.
4. `client/dist/theme-init.js` exists and begins with the T021 header comment.

Vite leaves a classic `<script src="/theme-init.js">` that points into `public/` untouched (it may log an informational notice that the file "can't be bundled without type=module"; that is expected and harmless). If a Vite upgrade ever rewrites or hashes the tag, assertion 1 fails loudly. **If T021's implementer had instead chosen inline-plus-hash** (they did not), the mitigation would have been to compute `sha256` of the inline script body at server start and append `'sha256-<base64>'` to `script-src`; that path is explicitly **not** implemented and the CSP constant above must remain byte-for-byte equal to the spec string.

### 4.5 The build pipeline and runtime resolution of `@slydr/shared`

The root `npm run build` (defined by T002; this ticket does not change it) typechecks, then builds `shared`, `server` and `client` to `client/dist`. This ticket gives the server workspace the real `build` and `start` scripts below and verifies the whole chain.

**`server/package.json`** gets (merge with what T008 created):

```json
{
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js --open"
  }
}
```

**`server/tsconfig.build.json`:**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "test"]
}
```

Requirements for the compiled output to run under plain `node` (no `tsx`, no loader, no `--conditions` flag):

1. `server/tsconfig.json` uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`, and relative imports inside `server/src` carry explicit `.js` specifiers (the convention T008 established). `tsc` then emits valid ESM that Node can load as is. If any relative import lacks its extension, `node server/dist/index.js` fails with `ERR_MODULE_NOT_FOUND`; fix the import rather than adding a bundler.
2. `@slydr/shared` resolves at runtime through the npm workspace link `node_modules/@slydr/shared` → `shared/`. Its `package.json` must expose built JavaScript: `"type": "module"` and an `exports` entry whose `default` (and `import`) target is `./dist/index.js`, with `"types": "./dist/index.d.ts"`. **Verify that no `development`/`source` condition pointing into `shared/src/*.ts` is required** for the server to start; such a condition is acceptable for `tsx` and Vite but must be absent from the plain-`node` resolution path. This is why `shared` is built first in the root `build` script.
3. Third-party packages (`express`, `sharp`, …) are resolved from the hoisted root `node_modules`; `server/dist` has no copy of them and does not need one.
4. `server/dist`, `shared/dist` and `client/dist` are git-ignored build artifacts (add them to `.gitignore` if T001 did not).

**Clean checkout.** T002's `typecheck` already builds `shared` first, so `npm ci && npm run build` works on a fresh clone; verify that once in an empty directory.

**Cross-directory check (acceptance item).** After `npm run build`, from a directory that is not the repository root:

```
cd %TEMP%                                   (cmd)      cd $env:TEMP                (PowerShell)      cd /tmp   (POSIX)
node <absolute path to>/server/dist/index.js --no-open
```

must start, print the banner, serve `/` with the HTML, and answer `/api/health`. This works only because no code uses `process.cwd()` to find `client/dist` or any other resource. `scripts/smoke-prod.mjs` (§4.8) automates exactly this.

### 4.6 `server/src/index.ts` changes

Add inside `main()` (T009 exports it; the module still starts `main()` only when it is the entry file, which is why T038's launcher calls `main()` explicitly), without disturbing the existing jail validation, loopback bind and port retry:

1. Parse flags from `process.argv.slice(2)`: `--open` and `--no-open` (no argument-parsing dependency).
2. Compute `clientDir = fileURLToPath(new URL('../../client/dist', import.meta.url))` and check `fs.existsSync(path.join(clientDir, 'index.html'))` (decision 4 in §4.1). Set `config.clientDir = clientDir` (T009 step 1's `config`) before `createApp(config, logger)` only when it exists. When it does not exist: if `--open` was given, print `Client build not found at <dir>. Run "npm run build" first.` to stderr and exit `1` before binding a port; otherwise log the single warning "client/dist not found; serving API only. Run npm run build." and continue with API only (decision 4 in §4.1).
3. After the existing retry loop binds, take the **actual** port from `server.address()` (an `AddressInfo`, never the preferred `PORT` value), build `const url = \`http://127.0.0.1:${port}\``, and unless `SLYDR_QUIET` is set print `Slydr is running at ${url}` to stdout. Also emit the existing structured log record with `startupMs: Math.round(process.uptime() * 1000)` so startup time is observable in the logs.
4. If `shouldOpen({ argv, env })` is true and the static layer is active, call `openBrowser(url)`.
5. Do not add signal handling: T009's `installShutdown` already handles `SIGINT` and `SIGTERM` (close, exit `0`), so Ctrl+C from `npm start` is clean on all platforms. A second handler would double-exit.

```ts
// server/src/openBrowser.ts (exported alongside openBrowser)
export function shouldOpen(ctx: { argv: string[]; env: NodeJS.ProcessEnv }): boolean {
  if (ctx.argv.includes('--no-open')) return false;
  if (ctx.env.SLYDR_NO_OPEN === '1' || ctx.env.SLYDR_NO_OPEN === 'true') return false;
  if (ctx.env.NODE_ENV === 'test') return false;
  return ctx.argv.includes('--open');
}
```

**Root `package.json`** (merge): `"start": "node server/dist/index.js --open"`. It invokes `node` directly: no shell-specific syntax, no dependence on the working directory, and no workspace indirection that could swallow Ctrl+C. Also add `"check:bundle": "npm run size:client"` (report-only, see T019) and `"smoke:prod": "node scripts/smoke-prod.mjs"` (report-only for time figures). Do not touch the other root scripts.

**Decision (not specified): `SLYDR_NO_OPEN` is a new documented environment variable.** Specification §13.2 is amended with this row (done in `specification.md`); add it also to the `server/src/config/env.ts` doc comment and, via T041, the README configuration table:

| Variable | Default | Purpose |
|---|---|---|
| `SLYDR_NO_OPEN` | unset | Set to `1` or `true` to stop `npm start` from opening a browser (also disabled by `--no-open` and by `NODE_ENV=test`). |

### 4.7 `server/src/openBrowser.ts`

```ts
import { spawn, type SpawnOptions } from 'node:child_process';

type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => {
  on(event: 'error', cb: (err: Error) => void): unknown;
  unref(): void;
};

const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/;

/** Opens `url` in the default browser. Never throws, never blocks, never keeps the process alive. */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnFn: SpawnFn = spawn as SpawnFn,
): boolean {
  if (!LOCAL_URL.test(url)) return false; // only ever our own loopback URL
  let cmd: string;
  let args: string[];
  if (platform === 'win32') {
    // `start` is a cmd.exe builtin, not an executable. The empty "" is the window title;
    // without it `start` would treat a quoted URL as the title. Node quotes an empty
    // argument as "". The URL is validated above, so it cannot contain '&', which cmd
    // would otherwise treat as a command separator.
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawnFn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); // e.g. xdg-open missing on a headless Linux box: ENOENT
    child.unref();
    return true;
  } catch {
    return false;
  }
}
```

If `openBrowser` returns `false` or the child errors, the banner has already told the user the URL; the failure is swallowed and, at most, logged at debug level (`SLYDR_QUIET` respected).

**Comparison and choice.** The `open` package handles WSL, Linux `xdg-open` fallbacks and Windows through PowerShell, but it is a new runtime dependency (with its own transitive dependencies) for a feature that is 20 lines here, and it makes the safety of the spawn arguments someone else's responsibility. An alternative on Windows that avoids `cmd` entirely is `rundll32 url.dll,FileProtocolHandler <url>`; it is equivalent for a validated URL but obscure. **Choice:** own helper with `cmd /c start "" <url>`, because the URL is restricted by regex to `http://127.0.0.1:<digits>/`, which removes every escaping hazard (`&`, `^`, `%`, spaces) that makes `start` risky for arbitrary URLs. If a future caller needs to open arbitrary URLs, switch to the `open` package instead of loosening the regex.

### 4.8 NFR-8 and NFR-9 verification

**Bundle size (target 300 KB gzipped, excluding images; reported, not enforced).** T019 already provides `scripts/check-client-size.mjs` (`gzipSync` over every `.js` and `.css` in `client/dist/assets/`, sums them, prints per-file and total sizes, warns above `300 * 1024` bytes, always exits `0`). **Do not write a second copy, and do not define a second measure.** This ticket exposes it under the name the spec's readers expect: `npm run check:bundle` (alias of `npm run size:client`). Run after `npm run build`. `theme-init.js` (under 1 KB) and `index.html` are not counted, consistent with T019's definition; sourcemaps are excluded because they are not `.js`/`.css` files. The app runs locally, so there is no strict budget.

**Startup time and cross-cwd run: `scripts/smoke-prod.mjs`.** A dependency-free Node script that proves the production path end to end:

1. Require `server/dist/index.js` and `client/dist/index.html` to exist; otherwise exit `2` with "Run npm run build first."
2. Create two temp directories (jail root with a file `hello.jpg`, and a cache dir). Spawn `process.execPath` with arguments `[<abs server/dist/index.js>, '--no-open']`, **`cwd: os.tmpdir()`**, env `{ ...process.env, PORT: '4517', SLYDR_ROOT: <root>, SLYDR_CACHE_DIR: <cache>, SLYDR_NO_OPEN: '1' }` (not quiet: the banner is the readiness signal). Port allocation across the repo: 4417 Playwright (T038), 4517 this script, 4617 the CI check scripts (T040).
3. Read stdout until the line matching `/http:\/\/127\.0\.0\.1:(\d+)/` appears (10 s timeout, then fail); record `t = performance.now() - spawnTime`. The captured port is the actual bound port.
4. With `fetch`: `GET /api/health` → `200`; `GET /` → `200`, header `content-security-policy` equals the spec string, `x-content-type-options: nosniff`, body contains `<div id="root">`; `GET /theme-init.js` → `200`; `GET /api/fs/list?path=` → `200`; `GET /api/does-not-exist` → `404` with JSON `error.code === 'NOT_FOUND'`; `GET /nope` → `404`.
5. Kill the child (`child.kill()`), remove the temp directories, and perform the whole sequence **twice**; the second iteration is the "warm" measurement. If its time from spawn to the first successful `GET /` exceeds `Number(process.env.SLYDR_STARTUP_TARGET_MS ?? 2000)` milliseconds, print a warning; **never fail on a time figure** (the app runs locally and slow CI runners would only make the gate flaky). **Decision (not specified):** the 2 s spec target covers browser time as well; this script measures the server's share (process start to HTML served). Functional failures (no banner within 10 s, wrong status or header) still exit `1`.
6. Print one summary line: `smoke:prod ok — cold <n> ms, warm <n> ms, port <p>`.

The browser-side share of NFR-8 (HTML to rendered explorer) is observed by the Playwright suite (T038) as an annotation; it is not a gate in this ticket or anywhere else.

**NFR-9 (no outbound requests).** There is nothing to configure beyond the CSP; the guarantees are asserted by tests: the built `index.html` and every built `.css` file contain no `http://` or `https://` reference to an origin (the only permitted literal is the SVG namespace `http://www.w3.org/2000/svg`), no `<link>`/`<script>` points off-origin, and the CSP has no `connect-src`, so `default-src 'self'` applies. JavaScript bundles are deliberately **not** scanned for URL strings: React's production build embeds `https://react.dev/errors/…` message text, which is never requested.

## 5. Acceptance criteria

Each item is a pass/fail check. Unless stated otherwise, run them after `npm run build` on a clean checkout.

1. **Static serving.** With `config.clientDir` set, `GET /` returns `200`, `Content-Type: text/html; charset=utf-8`, and the body of `client/dist/index.html`. `GET /index.html` also returns `200`.
2. **Security headers on HTML.** Every response for `/` carries `Content-Security-Policy` exactly equal to `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'`, plus `X-Content-Type-Options: nosniff` and `Cache-Control: no-cache`.
3. **Hashed assets are immutable.** A file matching `HASHED_ASSET` (for example `/assets/index-Dk3fA9xZ.js`) returns `Cache-Control: public, max-age=31536000, immutable`. `/theme-init.js` and `/index.html` return `Cache-Control: no-cache` (their names are stable, so they are revalidated by ETag). `GET /favicon.ico` returns `204` with no body.
4. **No directory listing, no dotfiles, no traversal.** `GET /assets/` does not list files; `GET /.env` and `GET /%2e%2e/package.json` never return file contents from outside `clientDir` (expect `404`). Validators stay enabled: a repeat request with `If-None-Match` for `/index.html` returns `304`.
5. **Router order.** `/api/*` routes still win over static serving; `GET /api/does-not-exist` returns `404` with the JSON envelope `{ "error": { "code": "NOT_FOUND", "message": … } }`, never `index.html`.
6. **SPA fallback is deliberately absent.** `GET /some/deep/path` returns `404` with `Content-Type: text/plain; charset=utf-8` and body `Not found` (decision 2 in §4.1), not `index.html`, because the app has no client-side router (spec §2.3, §16.1 A2).
7. **Method and host guards still apply.** `POST /` returns `405` through the existing method guard; a request with `Host: evil.example` returns `403` for static files as well as API routes.
8. **Missing client build.** Starting the server without `--open` (for example under `tsx watch`) when `client/dist/index.html` is absent logs a single warning ("client/dist not found; serving API only. Run npm run build.") and the API keeps working; `GET /` returns Express's default `404`, not HTML. Starting it with `--open` (that is, through `npm start`) instead exits with code `1` and the message `Client build not found at <dir>. Run "npm run build" first.`
9. **`npm start` works.** `npm run build && npm start` prints `Slydr is running at http://127.0.0.1:<port>` where `<port>` is the port actually bound (verify by occupying 4317 first: the banner must show the retry port, for example 4318, not 4317), and opens the default browser on that URL on Windows, macOS and Linux with a desktop session.
10. **No browser in non-interactive runs.** `node server/dist/index.js --no-open`, `SLYDR_NO_OPEN=1 npm start`, and any process with `NODE_ENV=test` never spawn a browser. A missing `xdg-open` does not crash or hang the server.
11. **Runs from any directory.** `scripts/smoke-prod.mjs` passes with the child process running in `os.tmpdir()`.
12. **Startup time (target, not a gate).** `npm run smoke:prod` passes its functional checks and reports a warm time to first HTML; on the developer machine (Windows 11) it is expected to be under 2000 ms. A slower time prints a warning and does not fail.
13. **Bundle size (target, not a gate).** `npm run check:bundle` prints the gzipped JS plus CSS total in `client/dist/assets` and exits `0`; the total is expected to be under 300 KB.
14. **No outbound requests.** The built `index.html` and built CSS contain no off-origin URLs (SVG namespace excepted), and the CSP contains no host other than `'self'`, `blob:` and `data:`. With the browser's network panel open, loading the app shows only requests to `127.0.0.1:<port>`.
15. **Dev workflow is unchanged.** `npm run dev` still starts the API on 4317 and Vite on 5173 with the proxy; the static layer is inactive there (no `clientDir`), and dev opens the browser through Vite's `--open`, not through `openBrowser`.
16. **Clean shutdown.** Ctrl+C in the terminal running `npm start` ends the process promptly with exit code `0` on all three operating systems (provided by T009's `installShutdown`; this ticket adds no second handler).

## 6. Tests to write

All tests below run in the Vitest `server` project (T002); none uses `node:test`.

### 6.1 `server/test/static.test.ts` (Vitest, Supertest)

Create a temporary directory per suite with `fs.mkdtemp(path.join(os.tmpdir(), 'slydr-dist-'))`, populated with:

- `index.html`: `<!doctype html><html><head><script src="/theme-init.js"></script></head><body><div id="root"></div></body></html>`
- `theme-init.js`: `/* init */`
- `favicon.svg`: a minimal `<svg xmlns="http://www.w3.org/2000/svg"/>`
- `assets/index-Dk3fA9xZ.js` and `assets/index-Qw8Lm2Rt.css`: any short content
- `assets/logo.svg`: unhashed name, to prove the immutability rule is not applied to it
- a file `.secret` at the root of the temp dir

Build the app with `createApp(makeTestConfig({ clientDir: tmp }), logger)` (T008/T012 helpers) and cover criteria 1 to 8: content types, exact CSP string (import the `CSP` constant for one assertion and also compare to the literal string in another, so an accidental change to the constant is caught), the three `Cache-Control` classes, `404` JSON for unknown `/api/*` paths, `404` for deep non-API paths, `405` for `POST /`, `403` for a bad `Host` header, no response for `/.secret`, no listing for `/assets/`, and the traversal attempt `GET /%2e%2e/<name of a file in the parent directory>`. Also assert `GET /favicon.ico` returns `204` with an empty body, and that a conditional `GET /index.html` with the returned `ETag` in `If-None-Match` returns `304`. Add a case that builds the app with `clientDir` unset and asserts `GET /` returns `404` and no HTML, and that API routes still work. Remove the temp directory in `afterAll`.

### 6.2 `server/test/builtHtml.test.ts` (contract test over the real build)

Skipped with `describe.skipIf(!fs.existsSync(distIndex))` when `client/dist/index.html` does not exist, so `npm test` works on a checkout that has not been built. To keep it from passing vacuously in CI, T040's workflow runs `npm run build` **before** `npm test`; with a built tree the file really runs on every leg. Assertions:

1. Every `<script>` has a `src` that starts with `/` and has no inline body, so `script-src 'self'` suffices (also guards against a plugin introducing inline code).
2. The first `<script>` in `<head>` is `<script src="/theme-init.js"></script>` with no `defer`, `async` or `type="module"`, and it precedes the `<script type="module">` tag (the T021 requirement, see §4.4).
3. No `<link>` or `<script>` references an `http:` or `https:` URL.
4. Every `.css` file in `client/dist/assets` contains no `http://` or `https://` substring other than `http://www.w3.org/2000/svg`; no `@import url(` pointing off-origin; no `url(` with a non-relative, non-`data:` target.
5. Every file under `client/dist/assets` named with a hash matches `HASHED_ASSET` (confirms the Vite file-name pattern and the regex have not drifted).

### 6.3 `server/test/openBrowser.test.ts`

Pure unit tests with an injected `spawnFn` stub that records its arguments and returns an object with `on` and `unref` mocks:

- `win32` produces `cmd` with `['/c', 'start', '', 'http://127.0.0.1:4317']`, `detached: true`, `stdio: 'ignore'`, `windowsHide: true`.
- `darwin` produces `open` with `[url]`; `linux` produces `xdg-open` with `[url]`.
- `unref` is called; an `error` event listener is attached (the stub invokes the listener with an `ENOENT` error and the test asserts nothing throws).
- Returns `false` and never calls `spawnFn` for `http://127.0.0.1:4317/&calc`, `https://127.0.0.1:4317`, `http://localhost:4317`, `http://evil.example` and the empty string.
- `shouldOpen`: `--open` only → true; `--open --no-open` → false; `--open` with `SLYDR_NO_OPEN=1` → false; `--open` with `NODE_ENV=test` → false; no flags → false.

### 6.4 Smoke script

`scripts/smoke-prod.mjs` is itself the end-to-end check for criteria 9 to 12 and 14 (server side). It is run by `npm run smoke:prod` and added by T040 to the CI workflow after the build step (report-only for time figures). It has no Vitest wrapper.

### 6.5 Manual checks (record the result in the pull request)

- Windows 11: `npm run build; npm start` opens Chrome or Edge on the printed URL.
- macOS and Linux desktop: same command opens the default browser. Linux without a desktop (container or SSH): server starts, banner prints, no crash.
- Occupy port 4317 (for example by starting a second instance), then run `npm start`: the banner and opened URL both use the retry port.

## 7. Definition of done

- [ ] `server/src/config/env.ts` (`ServerConfig.clientDir`), `server/src/app.ts`, `server/src/index.ts` and the new `server/src/openBrowser.ts` implement §4.2 to §4.7, with strict TypeScript and no `any`; `createApp`'s signature is unchanged and every earlier server test still passes untouched.
- [ ] `server/tsconfig.build.json`, the server `build` and `start` scripts and the root `start`, `check:bundle` and `smoke:prod` scripts exist, and none use shell-specific syntax (no `&&` chains that differ per shell, no `$VAR`, no `cp`, no `rm`).
- [ ] `scripts/smoke-prod.mjs` exists and passes locally on Windows 11 and, through CI, on Linux and macOS.
- [ ] The three new test files pass under `npm test`; the contract test passes after a build.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:bundle` and `npm run smoke:prod` pass from a clean `npm ci`.
- [ ] `SLYDR_NO_OPEN` is documented in `env.ts` and is a row in specification §13.2 (the README row comes with T041).
- [ ] The CSP string in the code matches spec §13.1 character for character.
- [ ] No new runtime dependency was added (no `open`, `serve-static` or `compression` package).
- [ ] The manual checks in §6.5 are recorded in the pull request description.

## 8. Notes and gotchas

- **The CSP and Vite.** Vite's production build must not emit an inline script. If a future Vite plugin (for example a legacy-browser or modulepreload polyfill option) injects inline code, the contract test in §6.2 fails; fix it by removing the plugin or disabling the polyfill (`build.modulePreload.polyfill: false` is acceptable only if the supported browsers load modules natively, which they do for the Chrome, Firefox, Safari and Edge versions in the spec). Do not weaken the CSP with `'unsafe-inline'` in `script-src`.
- **`style-src 'unsafe-inline'` is intentional.** React sets inline `style` attributes (for example the slide-show transform and dynamic grid sizes), which `style-src 'self'` would block. The spec's CSP already allows it; do not tighten it.
- **`img-src blob: data:`** supports placeholders and any object URLs; the real images arrive from `'self'` through `/api/image/…`. Do not add other sources.
- **Windows and `cmd /c start`.** `start` treats its first quoted argument as a window title, which is why the empty-string argument is mandatory. Without it the command appears to do nothing for some URLs. Because the URL is regex-validated, there is no injection surface; do not relax that regex.
- **Windows process kill.** On Windows `child.kill()` terminates only the immediate Node process, which is correct here because `smoke-prod.mjs` spawns `node` directly rather than through `npm` or a shell. Do not change it to `spawn('npm', …)`: the shell wrapper would be killed while the server survived and hold the port.
- **Why not `NODE_ENV=production`.** Setting an environment variable inline is shell-specific (`set X=1 &&` on cmd, `$env:X` in PowerShell, `X=1` on POSIX). The server therefore decides from the presence of `client/dist` and from explicit flags, as recorded in §4.1. If someone later wants a `NODE_ENV` check, use `cross-env` rather than inline syntax.
- **ESM and `__dirname`.** `__dirname` does not exist in ESM output; use `fileURLToPath(new URL('…', import.meta.url))` as shown. After compilation, `import.meta.url` of `server/dist/index.js` makes `../../client/dist` resolve to the repository's `client/dist`; if the compiled layout ever changes (for example `outDir` becomes `dist/src`), the relative path must be updated and the smoke script will catch it.
- **Port banner timing.** Printing the banner before the retry loop finishes would show a port that is not bound. Only print after `listen` succeeds, using the address reported by the server.
- **`express.static` and Express 5.** `express.static` is unchanged in Express 5. Do not add a catch-all `app.get('*', …)` or `app.get('/{*splat}', …)` fallback: there is no client router, and a fallback would turn API typos into HTML responses (criteria 5 and 6).
- **Antivirus and first-run latency on Windows.** The first start after a build can be noticeably slower because of real-time scanning of fresh `dist` files; this is why the smoke script measures the second (warm) run against the target and only reports the cold run.
- **Caching during development of the app itself.** `no-cache` on HTML plus hashed asset names means a rebuilt app shows up on a normal reload. If a developer sees a stale page, the cause is almost always a service worker or a manually pinned cache from another project served on the same `127.0.0.1` port.
- **Out of scope but adjacent.** CI wiring of `smoke:prod` and Playwright against the production server belongs to T040 and T038; this ticket supplies the commands they call.


