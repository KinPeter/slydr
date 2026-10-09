# T007 review — 2026-10-09

## Acceptance criteria

| Criterion | Status |
|-----------|--------|
| 6 functions exported from paths.ts | PASS |
| No import statements in paths.ts | PASS |
| normalizeWirePath matches spec §4.8 | PASS |
| wireJoin, wireParent, wireBasename, wireSegments match table | PASS |
| wireParent('') returns null; wireParent('Pictures') returns '' | PASS |
| breadcrumbSegments('') returns one entry | PASS |
| breadcrumbSegments('Pictures/2024/summer') returns four entries | PASS |
| .. segments preserved untouched | PASS |
| Barrel re-exports paths.js | PASS |
| tsc --noEmit clean | PASS |
| npm test passes | PASS |
| npm run lint clean | PASS |

No findings.
