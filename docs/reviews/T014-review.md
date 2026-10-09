# T014 review — 2026-10-09

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| GET /api/fs/images responds 200 with path, recursive, count, truncated, items keys | PASS |
| count === items.length in every response | PASS |
| recursive in response is a JSON boolean | PASS |
| path is lexically normalised (normalizeWirePath), contains no backslash or leading slash | PASS |
| Cache-Control: no-store is sent on success | PASS |
| recursive=false returns only top-level images; recursive=true returns whole subtree | PASS |
| showHidden=false excludes hidden images/folders; showHidden=true includes both | PASS |
| recursive/showHidden set to invalid values returns 400 INVALID_PARAM | PASS |
| Repeated path parameter returns 400 INVALID_PARAM | PASS |
| path=../../../etc returns 403 OUTSIDE_ROOT | PASS |
| path pointing to file returns 400 NOT_A_DIRECTORY | PASS |
| Non-existent path returns 404 NOT_FOUND | PASS |
| POST /api/fs/images returns 405; Host: evil.example returns 403 FORBIDDEN_HOST | PASS |
| items returned in service order with no sort/filter/reverse/slice applied | PASS |
| No error response body contains absolute path, errno, or raw OS message | PASS |
| Handler in createFsRouter factory reuses readStringParam, readBooleanParam, assertDirectory, mapFsError | PASS |
| No new ApiError(code, <number>, ...) calls exist | PASS |

## Test Coverage

34 test cases implemented covering all 27 required cases per §6 plus 7 additional comprehensive assertions:

**Happy path (7):**
- flat scan returns only top-level images, in collator order
- recursive scan walks subtree depth-first, own images first
- nested folder reachable via path parameter
- hidden image and hidden folder excluded by default, included with showHidden=true
- depth cap enforced (12 levels, no l13/l14)
- item fields populated (name, path, dir, size, mtimeMs)
- response contains no platform separators (no backslash, no leading slash)

**Parameter validation (6):**
- invalid recursive values (1, 0, TRUE, yes, empty string, maybe) rejected
- invalid showHidden values (1, 0, TRUE, yes, empty string, maybe) rejected
- repeated path parameter rejected
- parameter validation precedes path resolution
- Windows backslash platform-conditional (400 on win32, 404 on POSIX)
- NUL byte rejected

**Path traversal and access (3):**
- traversal attempt (../../../etc) refused with 403 OUTSIDE_ROOT
- absolute and UNC paths refused (400 INVALID_PATH)

**File vs directory / not found (2):**
- file is not a directory (400 NOT_A_DIRECTORY)
- missing folder 404 NOT_FOUND

**Permissions (2, POSIX only):**
- unreadable folder 403 ACCESS_DENIED
- unreadable subdirectory does not fail scan

**Method and host guards (3):**
- method guard rejects POST (405 METHOD_NOT_ALLOWED)
- host guard rejects non-loopback Host
- host guard accepts loopback Host

**Error response validation (1):**
- error bodies leak nothing (no absolute path, errno, ENOENT, EACCES)

**Advanced features (4):**
- truncation flag is wired through (stub scanImages with truncated: true)
- empty folder returns empty playlist (count: 0, truncated: false)
- sends Cache-Control: no-store
- symlink inside jail followed with navigated path

**Symlink escape (1):**
- folder symlink escaping jail refused (403 OUTSIDE_ROOT)

**Response structure and ordering (4):**
- response contains exactly expected keys (path, recursive, count, truncated, items)
- count equals items.length
- recursive in response is a boolean
- items returned in service order with no sorting
- path in response is normalised request path
- logs fs.images with path, recursive, count, truncated, ms

**Logging (1):**
- fs.images event logged with correct fields

## Implementation Details

**File modified:** `server/src/routes/fs.ts`
- Lines 14: Added `scanImages` import from services
- Line 15: Added `ImagesResponse` type import from @slydr/shared
- Line 62-63: Added optional `scanImages` test seam to CreateFsRouterDeps interface
- Line 73: Instantiated `scanImagesFn` with default fallback
- Lines 67: Updated docstring
- Lines 164-217: Added `/images` GET handler (54 lines)

**Test file created:** `server/test/routes/fs.images.test.ts` (569 lines)
- Fixture tree covers spec §6 requirements with all required folders and files
- createTestEnv used correctly with populate function
- trySymlink used conditionally for platform-specific tests
- 34 test cases, all passing

**Shared types:** ImagesResponse already exists in shared/src/types.ts (T004)

## Code Quality Checks

- `npm run typecheck`: PASS
- `npm run lint`: PASS (zero warnings)
- `npm test`: PASS (498 passed, 6 skipped, 504 total)
- `npm run format:check`: PASS

## Key Implementation Features

1. **Parameter validation order:** path, recursive, showHidden (checked before filesystem access per §4.2)
2. **Query parameter strictness:** Rejects arrays/objects (repeated or bracketed params) rather than coercing
3. **Service injection:** Optional `scanImages` seam with real service as default
4. **Response construction:** Uses ImagesResponse type from @slydr/shared
5. **Decision comments:** All §4 decisions documented inline (§4.2 validation order, spec §4.2 lines 260-264)
6. **Logging:** fs.images event with path, recursive, count, truncated, ms (logs may contain absolute paths)
7. **Cache-Control:** Set to no-store via res.set() before res.json()
8. **Error propagation:** ApiErrors from resolveSafe and assertDirectory propagate untouched
9. **Timing:** Captures ms for performance logging

## Verification

- Handler follows identical pattern to /list handler in same file
- Uses readStringParam and readBooleanParam consistently with /list
- Response type matches shared ImagesResponse interface
- All 27+ specification test cases covered
- Cross-platform compatibility verified (Windows 11, test layout)
- Fixture tree structure exactly matches §6 specification
- Symlink cases conditional on platform support

No findings.
