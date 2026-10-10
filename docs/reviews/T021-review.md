# T021 review — 2026-10-10

| # | Acceptance criterion | Result |
|---|----------------------|--------|
| 1 | `client/public/theme-init.js` exists, dependency-free ES5, `localStorage` read in `try`/`catch`, matches §4.2 listing | PASS |
| 2 | `client/index.html` loads it via `<script src="/theme-init.js"></script>` in `<head>`, no `defer`/`async`/`type="module"`, after `color-scheme` meta | PASS |
| 3 | `client/index.html` no longer contains the T019 placeholder and records the `script-src 'self'` CSP decision in a comment | PASS |
| 4 | Stored `"dark"` on light OS paints dark on first frame, no flash (parser-blocking pre-paint script) | PASS |
| 5 | No stored value on dark OS paints dark with no `data-theme` attribute | PASS |
| 6 | `client/src/state/theme.ts` exports `Theme`, `THEME_STORAGE_KEY` (`'slydr.theme'`), `DARK_MEDIA_QUERY`, `readStoredTheme`, `writeStoredTheme`, `clearStoredTheme`, `prefersDark`, `resolveEffectiveTheme`, `applyTheme` per §4.4 | PASS |
| 7 | `readStoredTheme()` returns `null` for absent/invalid key and when storage throws | PASS |
| 8 | `applyTheme(null)` removes `data-theme`; `applyTheme('light'/'dark')` sets it | PASS |
| 9 | `client/src/state/useTheme.ts` exports `useTheme(): UseThemeResult` with `theme`, `override`, `setTheme`, `toggleTheme`, `followSystemTheme` | PASS |
| 10 | Media-query `change` updates `theme` live while no override is stored | PASS |
| 11 | Listener detached once overridden; OS change does not alter `theme` | PASS |
| 12 | `toggleTheme()` on unoverridden dark OS stores `"light"`; on light OS stores `"dark"` | PASS |
| 13 | Storage throwing: app renders, toggle works for the session, nothing logged or surfaced | PASS |
| 14 | `ThemeToggle` is a single `<button type="button">` with exact `aria-label` `"Switch to dark theme"` / `"Switch to light theme"` | PASS |
| 15 | `Moon` icon in light mode, `Sun` in dark mode, SVG `aria-hidden="true"` | PASS |
| 16 | 44px min target (48px coarse pointer), `:focus-visible` ring via global rule, tokens only in CSS | PASS |
| 17 | Named `lucide-react` imports only | PASS |
| 18 | Client build emits `dist/theme-init.js`; gzipped bundle total under 300 KB | PASS |
| 19 | `followSystemTheme` exposed; no `use`-prefixed non-hook export in `client/src/state/` | PASS |
| 20 | `eslint.config.js` has the `client/public/**/*.js` entry; lint clean for `theme-init.js` | PASS |
| 21 | `client/test/scaffold.test.ts` asserts the script tag and passes | PASS |
| 22 | `client/test/helpers/matchMedia.ts` matches §6 API; all tests under `client/test/` import from `'vitest'` | PASS |
| 23 | `client` `package.json` unchanged (no dep added or re-versioned) | PASS |

Verification run: `npm run typecheck` clean, `npm run lint` clean, `npm test` 850 passed / 6 skipped (43 files), `npm run format:check` clean, `npm run build --workspace @slydr/client` emits `dist/theme-init.js` (1521 B, copied verbatim) with gzipped bundle total ≈ 73 KB.

No findings.
