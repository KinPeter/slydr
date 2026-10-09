# T015 review — 2026-10-09

## Acceptance Criteria

| Criterion | Status |
|---|---|
| Exports and router mounting | PASS |
| res.sendFile options | PASS |
| Path argument safety | PASS |
| GET /api/image returns 200 with correct bytes and Content-Type | PASS |
| Content-Type for all supported extensions | PASS |
| Range support, validators (ETag, Last-Modified) | PASS |
| 206 Partial Content and Range handling | PASS |
| 304 Not Modified for conditionals | PASS |
| Cache-Control contains private, max-age=3600 | PASS |
| X-Content-Type-Options: nosniff and SVG CSP | PASS |
| Unsupported extensions (415), uppercase accepted | PASS |
| Symlink naming (FR-2.1) | PASS |
| Directories and jail root return 400 NOT_A_FILE | PASS |
| Missing files, traversal, absolute paths | PASS |
| Missing/repeated path parameter | PASS |
| Files with special characters in names | PASS |
| Error responses not cacheable, no leaks | PASS |
| ECONNABORTED/EPIPE not logged above debug | PASS |
| 405, 403 FORBIDDEN_HOST, HEAD | PASS |

## Findings

No findings.

### Summary

- **PASS**: All 19 acceptance criteria met
- **BLOCKER**: 0
- **MAJOR**: 0
- **MINOR**: 0
- **Skipped tests**: 0 (all conditional tests have proper `ctx.skip()` handling)

## Implementation Quality

**Strengths:**
- Comprehensive test coverage with 45+ test cases across three test files
- All TypeScript strict mode checks pass (`noUncheckedIndexedAccess`, `import type`, etc.)
- ESLint and Prettier formatting clean with no warnings
- Proper use of `import type` on Express types in `imageTarget.ts`
- All decision comments documented at relevant lines (FR-2.1, CSP bidirectional check, etc.)
- Strong error handling with distinction between abort codes and real failures
- Correct path safety (never passes raw query to `sendFile`, always uses verified `absPath`-derived path)
- sendOptions correctly specifies `root`, `dotfiles: 'allow'`, and other mandated options
- CSV CSP applied bidirectionally (requested name OR resolved target extension)
- Cache-Control pre-set to avoid `send`'s default `public` value
- Tests verify Cache-Control on 200, 206, and 304 responses
- Comprehensive symlink tests including FR-2.1 cases (x.jpg→data.bin, photo-link→photo.jpg)
- Windows-specific junction test on win32 platform
- Proper abort logging at debug level only
- Headers reset before error responses to prevent error caching
- All modules properly sized for T017 reuse (`imageTarget.ts`, `sendFileSafe.ts` contain no image-specific code)

**Test Coverage:**
- Success: 22 cases (basic, MIME types, Range, conditionals, Cache-Control, CSP, HEAD, special chars, dotfiles, symlinks, folder symlinks, logging)
- Errors: 14 cases (415, 400, 404, 403 traversal/symlink, INVALID_PATH, backslash handling, INVALID_PARAM, cacheability, 405, FORBIDDEN_HOST, ACCESS_DENIED)
- Unit tests: 10 cases (readPathParam validation, resolveImageTarget, toSendFileRelativePath, resetFileHeaders, handleSendFileError, sendFileAsync)
- Platform-specific: Windows junction, Windows vs POSIX backslash, permission denial (skipped appropriately)

**No source edits requested** — review is read-only per instructions.
