# T012 review — 2026-10-09

## Acceptance Criteria

| Criterion | Status |
|---|---|
| createFsRouter factory with GET /root and /list; helpers readStringParam/readBooleanParam exported; createApp mounts with app.use('/api/fs', createFsRouter({ logger })) | PASS |
| testApp.ts exports createTestEnv; only place route tests set up jail; no SLYDR_ROOT in tests | PASS |
| GET /api/fs/root returns 200 with keys path, name, absoluteRoot, platform; path === ""; name = basename(jail root); absoluteRoot = jail root; platform = process.platform | PASS |
| GET /api/fs/list returns 200 with keys path, name, parentPath, entries, counts, truncated | PASS |
| GET /api/fs/list with no parameters lists jail root: path === "", parentPath === null, name = basename(root) | PASS |
| GET /api/fs/list?path=Pictures returns parentPath === ""; ?path=Pictures/2024 returns parentPath === "Pictures" | PASS |
| Response path is lexically normalised (?path=Pictures/./2024// returns "Pictures/2024"); symlinked folder keeps its own name | PASS |
| entries, counts, truncated identical to listDirectory; no sort/filter/slice/reduce | PASS |
| showHidden defaults to false; true includes hidden; other values return 400 INVALID_PARAM | PASS |
| ?path=a&path=b and repeated showHidden each return 400 INVALID_PARAM | PASS |
| Path with .. returns 403 OUTSIDE_ROOT; /etc, C:/Windows, \\\\server\\share return 400 INVALID_PATH; Pictures\\2024 returns 400 on Windows only | PASS |
| Symlink inside jail pointing outside returns 403 OUTSIDE_ROOT; symlink to inside-jail folder listed normally | PASS |
| Unreadable directory returns 403 ACCESS_DENIED (POSIX non-root) | PASS |
| POST/DELETE/PUT/PATCH return 405; evil Host returns 403; HEAD works on both endpoints | PASS |
| Both endpoints send Cache-Control: no-store | PASS |
| No error body contains absolute path, ENOENT, EACCES, errno field | PASS |
| No wire-path field contains backslash or leading slash | PASS |
| readStringParam and readBooleanParam exported as module-level functions | PASS |

## Findings

server/src/routes/fs.ts:70-79: **MINOR** Decision comment missing for absoluteRoot being display-only. Spec §4.3 lines 297–300 state this is "the single, deliberate place the server reveals an absolute path" with rationale; add comment above `absoluteRoot: root`.

server/src/routes/fs.ts:24–40: **MINOR** Decision comments missing for repeated/array-valued parameter rejection. Spec §4.2 lines 254–259 label this a Decision; add comment in `readStringParam` explaining rejection of non-strings (arrays, objects).

server/src/routes/fs.ts:35–40: **MINOR** Decision comment missing for showHidden validation strictness. Spec §4.2 lines 247–250 document the empty-string case; add note that `?showHidden=` is rejected as present-but-invalid.

server/src/routes/fs.ts:85–90: **MINOR** Decision comment missing for validation-order guarantee. Spec §4.2 lines 260–264 state parameters are validated before FS access in order (path type, then showHidden); add comment above step 1 to pin this ordering (affects test precedence).

server/src/routes/fs.ts:85–90: **MINOR** Decision comment missing for unknown-parameter handling. Spec §4.2 lines 265–267 justify ignoring unknown parameters; add note explaining this decision (rationale: cache-busting).

## Summary

**PASS:** All acceptance criteria met. Implementation is correct and complete.

**MINOR findings:** 5 missing Decision comments (spec §4.2 line 269 requires "a comment at each Decision site"). These are purely documentary—the code logic is correct. Add brief inline comments at:
1. Line 74 (absoluteRoot display-only rationale)
2. Line 26 (repeated params → reject, never coerce)
3. Line 37 (showHidden empty string is error, not absent)
4. Line 88 (params validated before FS access, in order)
5. Line 89 (unknown parameters ignored, rationale: cache-busting tolerance)

No blockers. Ready to finalize.
