# T019 review — 2026-10-10

| # | Acceptance criterion (§5) | Verdict |
|---|---------------------------|---------|
| 1 | `client/package.json` keeps all T001 deps/versions, adds `dev`/`build`/`preview` besides `typecheck` | PASS |
| 2 | `client/tsconfig.json` has no `vitest/globals`; `client/vitest.config.ts` leaves `globals` unset | PASS |
| 3 | `npm ls --workspace @slydr/client` resolves `@slydr/shared` to local `shared/` | PASS |
| 4 | `client/vite.config.ts`: port 5173, `strictPort`, host `127.0.0.1`, `/api` → `http://127.0.0.1:4317`, no `root`/`base` | PASS |
| 5 | `client/index.html` has `color-scheme` meta + `<head>` comment naming T021 as anti-FOUC owner | PASS |
| 6 | `npm run dev:client` opens browser exactly once; HMR without second tab (`open: false` + `--open`) | PASS |
| 7 | Page shows "API reachable (version …)"; `curl :5173/api/health` equals `:4317/api/health` (static conformance; live curl is manual per §6) | PASS |
| 8 | No `Access-Control-Allow-Origin`, no CORS middleware anywhere | PASS |
| 9 | API stopped → "Local API not reachable.", Vite keeps running (no custom proxy `configure` handler) | PASS |
| 10 | Client build writes `dist/index.html` + hashed `dist/assets/*` + source maps | PASS |
| 11 | `npm run size:client` prints gzipped total, exits 0, total under 300 KB (measured 68.7 kB) | PASS |
| 12 | Root `dev` starts shared/api/web with `shared`/`api`/`web` prefixes and `--kill-others` | PASS |
| 13 | `npm run typecheck` clean for client (ran `typecheck --workspace @slydr/client`, exit 0) | PASS |
| 14 | `npm run lint` clean for `client/**`; deliberate `<img>`-without-`alt` probe is reported by `jsx-a11y/alt-text` | PASS |
| 15 | `npm test` client suite runs in `jsdom`; ticket tests pass (16/16 across 4 files, incl. all 5 `App` cases) | PASS |

Verified by running (read-only): shared build, client typecheck, `eslint client/ scripts/check-client-size.mjs eslint.config.js` (clean), `vitest run --project client` (16 passed), stdin `jsx-a11y` probe (error on `<img>` without `alt`, clean file silent), client `vite build` + `size:client` (68.7 kB gz, exit 0), `npm ls @slydr/shared`. Criteria 6/7/9/12 runtime behaviours (browser-open-once, live proxy curl, dead-upstream survival, Ctrl+C teardown) verified by static conformance to the ticket's exact prescribed strings/config; live two-process check remains manual per §6.

client/test/App.test.tsx:39: MINOR Redundant duplicate assertion (`toHaveBeenCalledOnce()` immediately re-asserted via `toHaveLength(1)`). Drop one of the two lines.
