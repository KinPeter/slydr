# T025 review — 2026-10-10

| # | Criterion (§5) | Verdict |
|---|---|---|
| 1 | `client.ts` exports `getHealth`, `getRoot`, `list`, `getImages`, `imageUrl`, `thumbUrl`, `fetchThumbnailBlob`, `ThumbSize`, `THUMB_SIZES`, `DEFAULT_THUMB_SIZE`, `ApiClientError`, `ApiError` (alias), `isApiClientError`, `isAbortError`, `createAbortError` with §4.3 signatures | PASS |
| 2 | `fetchThumbnailBlob` requests exactly `thumbUrl(path, size)` with `Accept: image/webp`, resolves blob on 2xx, same `ApiClientError` mapping on errors, abort error (not `ApiClientError`) on abort | PASS |
| 3 | No `ApiClientError` code outside `ApiErrorCode`; no `'NETWORK'` code in client | PASS |
| 4 | `thumbUrl` size type `128 \| 256 \| 384 \| 512`, defaults `256`, cast-outside-allowlist yields `size=256` | PASS |
| 5 | URL table (§4.3) reproduced exactly | PASS |
| 6 | Booleans always `"true"`/`"false"`, including defaults | PASS |
| 7 | Awkward path round-trips through `decodeURIComponent`; lone-surrogate path does not throw | PASS |
| 8 | Every produced URL starts with `/api/`, contains no `://` and no leading `//` | PASS |
| 9 | Known-code envelopes (400/403/404/405/415/500) become `ApiClientError` with that code, server message, HTTP status | PASS |
| 10 | Empty/non-JSON/HTML/missing-`error`/unknown-code bodies become `READ_FAILED` + real status + exact message | PASS |
| 11 | 200 with non-JSON body or failed structural check becomes `READ_FAILED` | PASS |
| 12 | `fetch` rejection (`TypeError`) becomes `READ_FAILED`, status `0`, message exactly `Could not reach the Slydr server.` | PASS |
| 13 | Abort (during fetch, already-aborted, custom reason, body read) rejects with `isAbortError === true`, never `ApiClientError` | PASS |
| 14 | `isAbortError` false for `ApiClientError`, `TypeError`, `null`, string (plus `undefined`) | PASS |
| 15 | `useAbortableRequest` aborts previous on re-`run`, rejects superseded (even if resolved) with abort error, aborts on unmount, `cancel`, stable `run`/`cancel` | PASS |
| 16 | `no-outbound-requests.test.ts` passes (82/82 tests green across the 3 files; manual negative-verify not repeatable here) | PASS |
| 17 | ESLint `no-restricted-globals` entry active for `client/src/**` minus `api/client.ts` | PASS |
| 18 | No ESLint/TypeScript suppression comments in `client.ts` | PASS |

Verified: `vitest run --project client` on the 3 new test files — 82 passed; `tsc --noEmit -p client` clean; `eslint` on all new/changed files clean. `fetch(` appears only in `client/src/api/client.ts`; no `http(s)://`, `URLSearchParams`, or `new URL(` in `client/src/api`; `ThumbSize` aliases shared `ThumbnailSize`; `KNOWN_CODES` uses `hasOwnProperty`; `isAbortError` is name-based (realm-independent).

client/test/api/client.test.ts:153: MAJOR Lone-surrogate test uses U+FFFD (`'bad�name.jpg'`), for which `encodeURIComponent` never throws, instead of a real lone surrogate (`'\uD800'`). The `encode` fallback branch (`client.ts:101-111`) is never exercised. Use an actual lone surrogate and assert the output contains `%EF%BF%BD`.
client/test/no-outbound-requests.test.ts:60: MINOR `collectSourceFiles` only collects `.ts`/`.tsx`, so `.css` files (present throughout `client/src`, e.g. `styles/`, `components/`) are never scanned for `http(s)://`. An external `@import`/`url()` in CSS would evade the NFR-9 guard. Include `.css` in the scan.
