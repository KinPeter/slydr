# Slydr — Development Tickets

Source of truth: [`../docs/specification.md`](../docs/specification.md) (v1.0, 2026-10-08).

Tickets are dependency-ordered and numbered from a ground-up start: `T001` assumes an
empty repository. Each ticket is self-contained — an implementation agent receiving a
single ticket file plus the repository has everything needed to complete the work
without reading any other ticket.

Ticket structure is defined by [`_TEMPLATE.md`](_TEMPLATE.md): Context, Scope,
Prerequisites and assumed state, Implementation detail, Acceptance criteria, Tests to
write, Definition of done, Notes and gotchas.

## Phase 1 — Foundation

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T001](T001-repo-scaffold.md) | Create npm workspaces monorepo scaffold | E1 | — |
| [T002](T002-lint-format-test-tooling.md) | Configure ESLint 9 flat config, Prettier and Vitest | E1 | T001 |
| [T003](T003-ci-skeleton.md) | Add GitHub Actions CI skeleton | E1 | T001, T002 |

## Phase 2 — Shared domain package

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T004](T004-shared-types.md) | Define the shared API contract types | E2 | T001, T002 |
| [T005](T005-shared-image-classification.md) | Implement the image extension set and MIME map | E2 | T004 |
| [T006](T006-shared-config.md) | Implement `SlideshowConfig` defaults and `parseConfig` | E2 | T004 |
| [T007](T007-shared-path-helpers.md) | Implement POSIX wire-path helpers | E2 | T004 |

## Phase 3 — Server

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T008](T008-server-app-factory-and-guards.md) | Express app factory, error envelope and transport guards | E3 | T001, T002, T004 |
| [T009](T009-server-bootstrap-and-logging.md) | Bootstrap, loopback bind, port selection, structured logging | E3 | T008 |
| [T010](T010-server-path-jail.md) | Implement `resolveSafe` path containment | E4 | T008, T009 |
| [T011](T011-server-listing-service.md) | Directory listing service (classify, sort, hidden, truncate) | E5 | T010 |
| [T012](T012-server-fs-routes.md) | `GET /api/fs/root` and `GET /api/fs/list` | E5 | T011 |
| [T013](T013-server-image-scan-service.md) | Flat and recursive image scan service | E6 | T010, T011 |
| [T014](T014-server-images-route.md) | `GET /api/fs/images` | E6 | T013 |
| [T015](T015-server-original-image-route.md) | `GET /api/image` original image streaming | E7 | T010 |
| [T016](T016-server-thumbnail-service.md) | `sharp` thumbnail pipeline with on-disk cache | E8 | T004, T008, T010 |
| [T017](T017-server-thumb-route.md) | `GET /api/thumb` | E8 | T015, T016 |
| [T018](T018-server-thumbnail-cache-lru.md) | Thumbnail cache size cap and LRU sweep | E8 | T009, T016 |

## Phase 4 — Client foundation

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T019](T019-client-scaffold-and-dev-proxy.md) | Add Vite config, dev proxy and app shell to the client workspace | E9 | T001, T002 |
| [T020](T020-client-design-tokens.md) | Design-token and base stylesheet layer | E9 | T019 |
| [T021](T021-client-theme-system.md) | Theme system, anti-FOUC script and toggle | E9 | T020 |
| [T022](T022-client-base-components.md) | Base component library | E9 | T020, T021 |
| [T023](T023-client-persistence-layer.md) | Validated `localStorage` persistence layer | E10 | T019, T006, T021 |
| [T024](T024-client-app-state-machine.md) | `AppStateProvider` and the view state machine | E10 | T023 |
| [T025](T025-client-api-client.md) | Typed API client | E10 | T019, T004 |

## Phase 5 — Screens

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T026](T026-explorer-screen-list-view.md) | File explorer screen with list view | E11 | T012, T022, T024, T025 |
| [T027](T027-explorer-grid-view-thumbnails.md) | Explorer grid view with lazy thumbnails | E12 | T017, T026 |
| [T028](T028-explorer-virtualization.md) | Virtualize the explorer for large folders | E13 | T026, T027 |
| [T029](T029-config-screen.md) | Slide show configuration screen | E14 | T014, T022, T024, T025 |

## Phase 6 — Player

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T030](T030-player-foundation.md) | Player foundation: modes, fitting, playlist, scheduler | E15 | T015, T025, T029 |
| [T031](T031-player-backgrounds.md) | Player background layers (flat and blurred cover) | E16 | T030 |
| [T032](T032-player-animations.md) | Ken Burns, crossfade and reduced-motion override | E17 | T030, T031 |
| [T033](T033-player-controls-overlay.md) | Controls overlay with auto-hide | E18 | T030 |
| [T034](T034-player-keyboard-and-fullscreen.md) | Keyboard shortcuts and `fullscreenchange` handling | E19 | T030, T033 |

## Phase 7 — Polish, quality and release

| Ticket | Title | Epic | Depends on |
|---|---|---|---|
| [T035](T035-responsive-pass.md) | Responsive pass across all three screens | E20 | T026–T034 |
| [T036](T036-accessibility-pass.md) | Accessibility pass across all three screens | E21 | T026–T034 |
| [T039](T039-production-serving.md) | Serve the built client from the server, `npm start` | E23 | T009, T019, T021 |
| [T041](T041-readme-and-docs.md) | README and user documentation | E25 | T039 |

## Notes

- Unit, API and component tests ship **inside** the ticket that introduces the logic (per
  specification.md §12.6).
- Phase 3 and Phase 4 are independent after T004–T007 and can run in parallel.
- Tests live in `<workspace>/test/`, mirroring `src/` (never next to the source): Vitest
  only discovers `shared/test/**/*.test.ts` (node; `.ts` only),
  `server/test/**/*.test.ts` (node; `.ts` only), and `client/test/**/*.test.{ts,tsx}` (jsdom)
  (T001 §4.1, T002 §4.7).
  Never in `src/`, never `__tests__/`, never `tests/` plural, never `*.spec.*`, never root
  `test/`; no globals. Reference snippets in
  tickets must compile under the repo's strict flags (`noUncheckedIndexedAccess`,
  `noImplicitOverride`, `verbatimModuleSyntax`).
- T041 creates `README.md`. No earlier ticket creates it: where an earlier ticket's definition
  of done asks for a README update and no README exists yet, treat it as "no change; the
  content is covered by T041".
- Client tests and helpers live in `client/test/`, mirroring `src/` (e.g. `client/test/state/storage.test.ts`); shared helpers are in `client/test/helpers/`. Tests import `describe/it/expect/vi` from `'vitest'` (globals are off). Never put tests in `client/src/` or `__tests__` folders.
- Client conventions (T021-T030):
  - **State access.** `useAppState()` returns the `AppState`; actions come from `useAppActions()` (stable functions, T024). No ticket destructures actions from `useAppState()`.
  - **Network access.** Only `client/src/api/client.ts` calls `fetch` (NFR-9, enforced by lint and a static test). Abort handling uses `isAbortError` and `useAbortableRequest` (T025).
  - **Boolean configuration options are native checkboxes** (T022 `Checkbox`, T029).
  - **Pointer handling in the explorer** is delegated on the listbox/grid container, not bound per row or tile (T026).
  - **Strict TypeScript.** Snippets must compile with `noUncheckedIndexedAccess` and `@types/react` 19 (no global `JSX` namespace).
- `SLYDR_ROOT` is a test-only jail-root override (§3.1) and must never be documented as
  a user feature.

### UI name contract (binding for T026, T029, T033, T035, T036, T041)

Accessible names, headings and titles are fixed here; tickets quote this table and tests use these exact strings.

| Element | Name / text |
|---|---|
| View mode | `role="group"` named "View mode" with two `IconButton`s "List view" and "Grid view" (`aria-pressed` reflects the mode) |
| Show hidden | one `IconButton`, constant name "Show hidden items", `aria-pressed` reflects state (no flipping label) |
| Up | "Up one level" |
| Theme toggle | "Switch to dark theme" / "Switch to light theme" |
| Breadcrumb | `<nav aria-label="Breadcrumb">`; ellipsis button "Show hidden folders" |
| Entry region | `role="listbox"` / `role="grid"`, `aria-label="Folder contents"`; the highlighted option keeps `aria-selected` |
| Explorer | visually hidden `h1` "Choose a folder"; button "Select this folder"; title "Choose a folder — Slydr" |
| Configuration | back link "Back to file explorer"; primary button "Play slide show"; slider "Duration for image shown" (the only slider); `h1` is the selected folder name; title "Slide show settings — Slydr" |
| Reduced-motion note | "Your system is set to reduce motion, so the slide show plays without animations. Your choice here is kept." |
| Player | region "Slide show", visually hidden `h1` "Slide show", title "Slide show — Slydr"; toolbar "Slide show controls"; buttons "Previous image", "Pause slide show" / "Play slide show", "Next image", "Enter full screen" / "Exit full screen", "Stop slide show" |
| Up-one-level keys | `Backspace`, `Alt+←` |

There is no player-side "failed" screen: when every image fails the player exits to the configuration screen with a notice (spec §9.3).

### CI contract

One row per verification script in the existing CI workflow. Size and startup figures are reported with a warning above the NFR-8 targets and never fail a build.

| Script | Owner | Command | Step |
|---|---|---|---|
| Typecheck, lint, format check | T002 | `npm run typecheck`, `npm run lint`, `npm run format:check` | after install |
| Build | T002, T039 | `npm run build` | before tests, so `server/test/builtHtml.test.ts` runs |
| Unit, API and component tests | T002 | `npm test` | after build |
| Bundle size report | T019, T039 | `npm run check:bundle` | after build (report only) |
| Production smoke and startup time | T039 | `npm run smoke:prod` | after build (report only) |
| README drift check | T041 | `npm run docs:check` | after tests |

### Port allocation

`4317` development API and default `npm start`; `5173` Vite; `4517` `smoke:prod` (T039).
- Server conventions shared by T011-T018:
  - **Dependency injection, no singletons.** `createApp(config, logger?, deps?)` builds every
    router and service. Routers are factories (`createFsRouter({ logger })`,
    `createImageRouter({ logger })`, `createThumbRouter({ logger, thumbnails })`); services take
    the T009 `Logger` and, for the thumbnail cache, `config.cacheDir` / `config.cacheMaxMb`
    from T008's `ServerConfig`. Log event names are `<area>.<event>` (`fs.list`, `scan.done`,
    `thumb.failed`, `cache.sweep`).
  - **Server tests never set `SLYDR_ROOT`.** They use the shared helpers
    `server/test/helpers/{fs,logger,testConfig,testApp}.ts` (created by T011, T008 and T012):
    `createTestEnv()` makes a temp tree, `setJailRoot`s it and returns a Supertest-ready app.
  - **`fs` import style.** Server code does `import fs from 'node:fs/promises'` and calls
    `fs.readdir(...)`, `fs.stat(...)` and so on, never `import { readdir } from ...`, so that
    `vi.spyOn(fs, 'readdir')` in tests intercepts the call.
  - **Backslash.** `resolveSafe` rejects a backslash only on Windows (§3.3); tests that send one
    are Windows-only or expect the POSIX behaviour.
  - **Symlinks.** A symlink is classified by its target's kind but, for files, image-ness comes
    from the symlink's own name (FR-2.1). Folder symlinks are followed while the real target is
    inside the jail; paths stay as navigated.
