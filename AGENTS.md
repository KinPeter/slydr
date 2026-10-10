# AGENTS.md — Slydr

Source of truth: `docs/specification.md` (v1.0) + `tasks/README.md`.
Each `tasks/T###-*.md` ticket is self-contained: implement exactly that ticket, do not read other tickets. Never edit `tasks/` or create root `README.md` (owned by T041).

## Stack

npm workspaces monorepo, TS 5.x strict ESM (`"type": "module"`), Node `>=22` (dev runs 24, `.nvmrc` says `22`).
Packages: `@slydr/shared` (pure types/constants/helpers, zero runtime deps) → `@slydr/server` (Express 5) + `@slydr/client` (Vite 7 + React 19, no router — in-app view state machine). Icons `lucide-react`, virtualization `@tanstack/react-virtual`, thumbnails `sharp@~0.34.4` (prebuilt binaries only — never add a dep needing a compiler toolchain).

## Commands (root only, `&&`-chained for cmd.exe compat)

| `npm run dev` | `tsx watch` server :4317 + Vite :5173, `/api` proxied (no CORS) |
| `npm run build` | typecheck → build shared → server → client |
| `npm start` | serve `client/dist` + `/api` on one origin, loopback only |
| `npm test` / `test:watch` | build shared first, then `vitest run` / watch |
| `npm run typecheck` | build shared → root tooling tsconfig → all workspaces |
| `npm run lint` / `format` / `format:check` | `eslint .` / `prettier --write .` / `--check .` |

Fresh clone has no `shared/dist`: run `npm run build -w @slydr/shared` before direct `tsc`/`vitest`. Never add deps in T001-listed tickets without cause. Ports: API 4317, Vite 5173, `smoke:prod` 4517, CI checks 4617.

## TypeScript imports

`shared` + `server` use `moduleResolution: NodeNext` → relative imports **must** end in `.js` (`from './app.js'`). `client` uses `bundler` → no extension. `shared` consumed via compiled `dist` through single `"."` export (no deep imports); `types: []` so any `node:*` import there must fail typecheck. Strict flags on: `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax` (`import type`), no `composite`/project references. LF endings enforced by `.gitattributes` + Prettier `endOfLine: lf`.

## Tests

No e2e (out of scope). Layout: `<workspace>/test/` mirroring `src/` only — never `src/`, `__tests__/`, `tests/`, `*.spec.*`, root `test/`. Vitest projects are `['shared','server','client']`; `shared`/`server` env node `include test/**/*.test.ts`, `client` jsdom `include test/**/*.test.{ts,tsx}` + `test/setup.ts`. No globals: always `import { describe/it/expect/vi } from 'vitest'`. No `passWithNoTests`, no `vitest.workspace.*`.

Server test rules: never set `SLYDR_ROOT` directly — use `server/test/helpers/` (`createTestEnv()` + `setJailRoot`, returns Supertest app). `import fs from 'node:fs/promises'` as default import only (so `vi.spyOn(fs,…)` works). Backslash-in-path cases are Windows-only. Symlink cases: classified by target kind, image-ness from symlink's own name; folder symlinks followed only inside jail, paths stay as-navigated.

Client test rules: helpers in `client/test/helpers/`; state via `useAppState()` (state) + `useAppActions()` (actions) — never destructure actions from state; only `client/src/api/client.ts` may call `fetch` (use `isAbortError`/`useAbortableRequest`); checkboxes native; explorer pointer handling delegated on container.

## Server invariants (spec §3)

Wire paths are POSIX, relative to jail root (`""` = home), never absolute. All FS access goes through `resolveSafe()` (`server/src/security/jail.ts`); string-concatenated paths are a defect — enforced by ESLint `no-restricted-syntax` in `server/src/**` (build URLs with `new URL()`, suppress legit hits with justified `eslint-disable-next-line`). DI only: `createApp(config, logger?, deps?)`, router factories, no singletons; log names `<area>.<event>` (`fs.list`, `thumb.failed`). Bind `127.0.0.1` only; reject non-GET/HEAD (405) and non-loopback `Host` (403); no CORS; CSP per §3.4 incl. SVG `sandbox` on `/api/image`; error envelope `{ error: { code, message } }` with codes in §3.5 — never leak OS messages or absolute paths in responses. `SLYDR_ROOT` is test-only (logs warning), never document as a feature. Env: `PORT` 4317 (+1…+9 fallback), `SLYDR_CACHE_DIR` (OS cache), `SLYDR_CACHE_MAX_MB` 500, `SLYDR_QUIET`, `SLYDR_NO_OPEN`.

## Client invariants (spec §6–9)

UI names/headings are fixed in `tasks/README.md` "UI name contract" — quote exact strings in code and tests. Theme: tokens in `styles/tokens.css`, override `slydr.theme` in `localStorage`, pre-paint `public/theme-init.js` as blocking classic script (CSP `script-src 'self'` forbids inline). Persistence: validated parsers, silent default fallback, `try/catch` around all storage (must work with storage disabled); theme writes immediately, rest debounced 250 ms. Player: fullscreen request inside click handler; Escape-in-fullscreen stays in player (browser consumes Esc — do not "fix"); timestamp scheduler, decode-before-advance, ≤3 `<img>` in DOM, Fisher–Yates via `crypto.getRandomValues`; animate `opacity`/`transform` only; honor `prefers-reduced-motion`.

## Definition of done (every ticket)

`npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run format:check` green; shared types for shared concepts; unit tests for new logic; keyboard + SR labels on new UI; check both themes at 320 px and 1920 px; no README change (T041 owns it).
