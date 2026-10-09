# T017 review — 2026-10-09

## Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | GET /api/thumb returns 200 with correct headers | PASS |
| 2 | size parameter produces correct dimensions | PASS |
| 3 | Invalid sizes rejected with 400 INVALID_PARAM | PASS |
| 4 | Size whitelist derived from @slydr/shared only | FAIL |
| 5 | Cache hit doesn't invoke renderer | FAIL |
| 6 | 304 with matching If-None-Match, no renderer | FAIL |
| 7 | Weak/wildcard validators match | PASS |
| 8 | File modification invalidates ETag | PASS |
| 9 | Symlink naming (FR-2.1) handled correctly | PASS |
| 10 | Error cases (415, 400, 404, 403) | PASS |
| 11 | Error responses don't leak paths/errno | PASS |
| 12 | HEAD, POST, FORBIDDEN_HOST guards | PASS |
| 13 | Routes reuse T015 helpers, no duplication | PASS |
| 14 | Client abort doesn't break server | FAIL |
| 15 | Cache file eviction retry logic | FAIL |
| 16 | createApp DI injection | PASS |
| 17 | computeThumbnailKey is single definition | PASS |

## Findings

server/src/routes/thumb.ts:37-39: **MAJOR** Performance inefficiency. The SIZE_BY_STRING Map is recreated on every parseSize() call. Build it once at module scope instead (as shown in spec section 4.4 pseudocode). Current code recreates the map for every query, wasting CPU and GC.

server/test/routes/thumb.test.ts:228-260: **MAJOR** Test doesn't verify acceptance criterion 5. The "cache miss then cache hit" test doesn't track the renders counter. Per spec AC#5 and §12.2 case 7, the test must verify `renders` didn't increment between the first and second identical request, proving the cache was used. Currently it only checks bytes and ETag match, which could both be cached by accident.

server/test/routes/thumb.test.ts:715-756: **MAJOR** Test doesn't actually test retry logic. The "retries once if the cache file vanishes before sending" test defines a fake service but never injects it via createTestEnv's deps option. The test only asserts `callCount <= 2` which always passes. Per spec §12.2 case 29, this test must programmatically cause the cache file to vanish on first getThumbnail and exist on second, then verify both calls happened and response is 200. This requires the fake service to be injected and actually used.

server/test/routes/thumb.test.ts:758-761: **MAJOR** Missing test case. The "returns 500 if cache file still vanishes after retry" test body is completely empty. Per spec §12.2 case 29 variant, this must inject a fake service that returns a non-existent path twice, verify getThumbnail is called twice, and assert the response is `500 THUMBNAIL_FAILED` with `error.code === 'THUMBNAIL_FAILED'` and `Cache-Control: no-store`.

server/test/routes/thumb.test.ts:656-709: **MAJOR** Client abort test is non-functional. The test tries to `http.request` on port 0 which won't connect to the Supertest app. The test creates a promise that resolves immediately without actually sending any bytes, so no abort is simulated. Per spec §12.2 case 28, the test must either: (a) use Supertest's raw request capability to actually connect to the app server, or (b) mock/spy on res.on('close') or similar to simulate abort. Currently the test passes vacuously because the abort never actually happens.

server/src/routes/thumb.ts:1-226: **MINOR** No module-level SIZE_BY_STRING export verification. The spec (AC#4, §4.4) requires "the numbers `128`, `256`, `384`, `512` do not appear as a second list in `routes/thumb.ts`." The current code builds the list dynamically in parseSize, which is correct, but a careful reading and grep should verify no hardcoded size constants exist outside comments and error messages. Grep: `grep -n '128.*256.*384.*512' server/src/routes/thumb.ts` — should only match the error message. Currently compliant but worth confirming in review.

---

## Summary

- All infrastructure (app wiring, test helper extension, error handling) is correct and well-commented.
- All error cases, parameter validation order, header handling, and symlink rules are properly implemented.
- Three test cases are completely non-functional (cache hit renders counter, eviction retry, missing double-eviction test) and must be fixed.
- One test (client abort) is non-functional and must be rewritten.
- Performance: Map recreation on every parseSize call should be fixed.

**Blockers for merge:** AC#5, #6, #14, #15 (test failures); AC#4 (performance).

## Notes on Spec Alignment

- Section 4.3 (decision on stat racing): Correctly implemented — expected key computed from initial stat, then service's returned key used for ETag on success.
- Section 4.4 (size whitelist as security property): Correctly built from THUMBNAIL_SIZES, not re-hardcoded.
- Section 4.6 step 5 (conditional request): matchesIfNoneMatch correctly parses comma-separated list and handles weak validators.
- Section 4.7 (eviction race, single retry): Implementation is correct but test is incomplete.
- Section 4.9 (concurrent abort): res.destroyed check after getThumbnail is correct; handleSendFileError covers abort during send.
