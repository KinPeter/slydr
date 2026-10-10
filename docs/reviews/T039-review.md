# T039 review — 2026-10-10

| Acceptance criterion | Result |
|---|---|
| 1. Static serving | PASS |
| 2. Security headers on HTML | PASS |
| 3. Hashed assets are immutable | PASS |
| 4. No directory listing, dotfiles, or traversal | PASS |
| 5. Router order and API 404 envelope | PASS |
| 6. No SPA fallback | PASS |
| 7. Method and host guards | PASS |
| 8. Missing client build behaviour | PASS |
| 9. `npm start`, actual port, and browser opening | PASS (automated checks only; desktop manual checks were not supplied) |
| 10. No browser in non-interactive runs | PASS |
| 11. Runs from any directory | FAIL on Windows |
| 12. Startup-time reporting | PASS on Linux; cross-platform smoke is affected by criterion 11 |
| 13. Bundle-size reporting | PASS |
| 14. No outbound requests | PASS for the built output; contract test coverage is incomplete |
| 15. Dev workflow unchanged | PASS |
| 16. Clean shutdown | PASS by reuse of the existing shutdown implementation |

Findings:

scripts/smoke-prod.mjs:7: <MAJOR> `new URL(...).pathname` produces a leading `/C:/...` pathname on Windows, so `resolve()` constructs an invalid repository path and the required cross-directory smoke check cannot locate the build. Use `fileURLToPath(new URL('..', import.meta.url))` (and then `resolve` if needed) for an OS-native path.
docs/specification.md:691: <MINOR> `SLYDR_NO_OPEN` is documented twice in §13.2, leaving duplicate configuration rows with slightly different wording. Remove the older duplicate and retain one authoritative row.

## Approval

Not approved until the Windows-safe smoke-script path is fixed and the smoke check is rerun on the supported platforms. The automated Linux typecheck, lint, test, build, bundle, and smoke commands passed; the requested Windows/macOS desktop browser manual checks were not evidenced in this review.
