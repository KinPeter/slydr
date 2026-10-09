# T008 review — 2026-10-09

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| `server/src/config/env.ts` exports `ServerConfig` and `readServerConfig`; returned object frozen | PASS |
| `readServerConfig({})` yields correct defaults | PASS |
| `readServerConfig({ SLYDR_ROOT: 'C:\\tmp\\fixture' })` yields correct override | PASS |
| `server/src/middleware/errorEnvelope.ts` exports required items | PASS |
| `ERROR_STATUS` contains exactly 12 codes mapped correctly | PASS |
| Every error response body is exactly `{ error: { code, message } }` | PASS |
| No response body contains errno, syscall, stack trace, or path separator | PASS |
| `createApp(config)` returns Express app and does not open socket | PASS |
| `GET /api/health` returns 200 with correct body and Cache-Control | PASS |
| Non-GET/HEAD methods return 405 with Allow header | PASS |
| Non-loopback Host returns 403 FORBIDDEN_HOST | PASS |
| Allowed Host values pass (all 6 forms) | PASS |
| Every response carries X-Content-Type-Options: nosniff | PASS |
| CSP_VALUE equals spec string exactly | PASS |
| `GET /api/does-not-exist` returns 404 with JSON body | PASS |
| X-Powered-By header absent | PASS |

## Findings

server/src/middleware/errorEnvelope.ts:49: MINOR: `apiNotFoundHandler` missing `Cache-Control: no-store` header. Per spec §3.5, "Set... `Cache-Control: no-store` on error responses"; this 404 handler should be consistent with errors thrown from routes (which get the header via the error middleware). Add `.set('Cache-Control', 'no-store')` before `.json()`.

server/test/app.test.ts:109: MINOR: Test for CSP header does not verify `/` path (CSP applies to `/` and `.html` per spec). Current test uses `/index.html` instead. Add a test case for `GET /` with `CSP_VALUE` check to fully cover the acceptance criterion "the CSP header is applied to an HTML-document path... on `GET /`"; note that `GET /` returns 404 via `apiNotFoundHandler` (no HTML served yet) but the header should still be present per the middleware.

## Summary

Implementation is substantially complete and correct. All critical functionality works: config parsing (all environment variables), error envelope with proper code-to-status mapping, transport guards (method, host), security headers, health endpoint, and app factory. All code paths verified to not leak OS detail (errno, syscall, paths) to response bodies. Middleware order correct. Type safety (import type) and ESM imports (with .js extensions) per spec. Tests cover all required scenarios for env parsing and host validation.

Two minor gaps: (1) `apiNotFoundHandler` should set `Cache-Control: no-store` for consistency with spec and error middleware behavior; (2) test for CSP on `/` path is missing (test uses `.html` instead). Both are fixable in isolation without affecting architecture. Typecheck, lint, and test suite all pass.

