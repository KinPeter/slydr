# T025 — Implement the typed API client

**Epic:** E10
**Spec sections:** §6.5, §3.5, §5.1–§5.6, NFR-9
**Depends on:** T019, T004
**Estimated size:** M

---

## 1. Context

The Slydr browser UI talks to exactly one thing: the local Slydr HTTP API served by the same Express process (in production) or proxied by the Vite dev server (in development). This ticket builds the single module through which every screen reaches that API: `client/src/api/client.ts`. It offers one typed function per JSON endpoint, two URL builders for the endpoints whose result goes straight into an `<img src>`, and a typed error class that turns the server's error envelope into something a screen can branch on.

Three requirements shape the module. First, every call must accept an `AbortSignal`, because two screens depend on cancelling requests (spec §6.5): the explorer aborts a pending `list` when the user navigates again, and the configuration screen aborts a pending `images` fetch when `includeSubfolders` is toggled twice quickly. Second, an abort must stay distinguishable from a real failure and must never be shown to the user. Third, NFR-9 forbids any outbound request to anything other than this local API, so the module builds only same-origin relative URLs, and the repository gets a guard that keeps it that way.

## 2. Scope

### In scope

- `client/src/api/client.ts`: `getHealth`, `getRoot`, `list`, `getImages`, `imageUrl`, `thumbUrl`, `fetchThumbnailBlob`, the `ApiClientError` class, `isAbortError`, and the shared request/error-handling core.
- Conversion of error envelopes, malformed bodies, network failures and aborts as specified in section 4.4.
- Light structural validation of success responses (section 4.5).
- `client/src/api/useAbortableRequest.ts`: the React helper for abort bookkeeping. It is **required**, not optional: the explorer listing (T026) and the configuration screen's image scan (T029) both use it instead of hand-rolled `AbortController` handling.
- NFR-9 guards: a unit test asserting only same-origin `/api/...` URLs are constructed, a static test scanning the client sources, and an ESLint restriction.
- A `fetch` test helper and the unit tests listed in section 6.

### Out of scope

- The server endpoints themselves — T008 to T018.
- Deciding how an error is presented (copy, banners, retry buttons). Screens map `ApiClientError.code` to their own wording: explorer — T026, configuration — T029.
- Retries, caching, request de-duplication, or any state management of responses. The client is a thin typed wrapper.
- Thumbnail concurrency capping, queueing, lazy loading and cancellation on navigation (FR-14.9) — T027. This ticket only builds the thumbnail URL and provides `fetchThumbnailBlob`, the single function through which thumbnail bytes are fetched.
- A base URL setting or CORS handling. There is neither: requests are same-origin, and Vite proxies `/api` in development.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo (`shared/`, `server/`, `client/`), ESM throughout, TypeScript 5.x strict, Node >= 22. The client is Vite 7 + React 19 at `client/` (T019) with a dev proxy `/api` to `http://127.0.0.1:4317`, design tokens (T020), the theme system (T021), and Vitest + React Testing Library in `jsdom` (T002: Vitest globals are **off**, so tests import `describe`, `it`, `expect`, `vi` from `'vitest'`; only `client/test/**/*.test.{ts,tsx}` is discovered; `unstubGlobals: true` restores `vi.stubGlobal` after every test). The server (T008 to T018) serves, all `GET`/`HEAD` only:

| Endpoint | Query | Success body |
|---|---|---|
| `/api/health` | none | `HealthResponse` |
| `/api/fs/root` | none | `RootResponse` |
| `/api/fs/list` | `path`, `showHidden` | `ListResponse` |
| `/api/fs/images` | `path`, `recursive`, `showHidden` | `ImagesResponse` |
| `/api/image` | `path` | image bytes (used as an `<img src>`, never fetched by this module) |
| `/api/thumb` | `path`, `size` | `image/webp` bytes (likewise) |

Boolean query parameters are the exact strings `"true"` and `"false"`; anything else is `400 INVALID_PARAM`. `size` must be one of `128`, `256`, `384`, `512`, else `400 INVALID_PARAM`. Wire paths are POSIX, forward-slash, relative to the jail root, with `""` meaning the root; the client never builds an absolute path.

`@slydr/shared` exports (the types this ticket consumes):

```ts
export interface HealthResponse { status: 'ok'; version: string }

export interface RootResponse { path: string; name: string; absoluteRoot: string; platform: string }

export type EntryType = 'folder' | 'image' | 'file';
export interface FsEntry {
  name: string; path: string; type: EntryType; hidden: boolean;
  size: number | null; mtimeMs: number | null;
}
export interface ListResponse {
  path: string; name: string;
  parentPath: string | null;
  entries: FsEntry[];
  counts: { folders: number; images: number; files: number };
  truncated: boolean;
}

export interface ImageItem { name: string; path: string; dir: string; size: number | null; mtimeMs: number | null }
export interface ImagesResponse {
  path: string; recursive: boolean; count: number; truncated: boolean; items: ImageItem[];
}

export type ApiErrorCode =
  | 'INVALID_PATH' | 'INVALID_PARAM' | 'OUTSIDE_ROOT' | 'FORBIDDEN_HOST'
  | 'NOT_FOUND' | 'NOT_A_DIRECTORY' | 'NOT_A_FILE' | 'ACCESS_DENIED'
  | 'UNSUPPORTED_IMAGE' | 'THUMBNAIL_FAILED' | 'READ_FAILED' | 'METHOD_NOT_ALLOWED';

export interface ApiErrorEnvelope { error: { code: ApiErrorCode; message: string } }
```

Every error response from the server has the form `{ "error": { "code": "OUTSIDE_ROOT", "message": "Path is outside the allowed root." } }` with a matching HTTP status (spec §3.5): 400 `INVALID_PATH`, `INVALID_PARAM`, `NOT_A_DIRECTORY`, `NOT_A_FILE`; 403 `OUTSIDE_ROOT`, `FORBIDDEN_HOST`, `ACCESS_DENIED`; 404 `NOT_FOUND`; 405 `METHOD_NOT_ALLOWED`; 415 `UNSUPPORTED_IMAGE`; 500 `THUMBNAIL_FAILED`, `READ_FAILED`. Server messages never contain an absolute path, `errno` or a raw OS error (spec §3.4).

Spec §6.5 calls the error class `ApiError`; section 4.2 exports it under both names. T026 and T029 import `ApiClientError`, `isAbortError` and `useAbortableRequest` from this module, and T027 fetches thumbnails only through `fetchThumbnailBlob`.

## 4. Implementation detail

### 4.1 Files

Create:

- `client/src/api/client.ts`
- `client/src/api/useAbortableRequest.ts` (section 4.7)
- `client/test/api/client.test.ts`
- `client/test/api/useAbortableRequest.test.tsx`
- `client/test/helpers/fetchMock.ts` (test helper, section 6)
- `client/test/no-outbound-requests.test.ts` (static NFR-9 guard)

Modify: the root ESLint flat config (section 4.8). Do not modify `vite.config.ts`; the `/api` proxy is already in place from T019.

### 4.2 The error class

```ts
import type { ApiErrorCode } from '@slydr/shared';

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number; // HTTP status; 0 when no response was received
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

/** Spec §6.5 calls this class `ApiError`; same class, second name. */
export const ApiError = ApiClientError;
export type ApiError = ApiClientError;

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}
```

**Decision (not specified): the class is named `ApiClientError`, with `ApiError` exported as an alias.** The server has its own `ApiError` class (in `server/src/middleware`) that carries a code and an HTTP status for the error-envelope middleware. Client and server never share that class; the only thing they share is the `ApiErrorCode` union from `@slydr/shared`. A distinct client name stops an editor auto-import from offering the wrong module, and keeps grep results unambiguous. The `ApiError` alias exists only because spec §6.5 uses that name; both names refer to the same class, so `instanceof` works with either. T026, T029 and every later ticket import `ApiClientError`, never the alias, so that no client file is ever confused with the server class of the same short name. The `code` field is typed `ApiErrorCode` (a closed union): there is no `'NETWORK'` or any other client-invented code. A network failure is `READ_FAILED` with status `0` (section 4.4), and screens must not normalise errors into new codes.

For `status`, a value of `0` means "no HTTP response was received" (network failure). Synthesised errors for a malformed response carry the real HTTP status.

### 4.3 Endpoint functions and URL builders

```ts
import type {
  HealthResponse, ImagesResponse, ListResponse, RootResponse, ThumbnailSize,
} from '@slydr/shared';
import { DEFAULT_THUMBNAIL_SIZE, THUMBNAIL_SIZES } from '@slydr/shared';

// The thumbnail size allowlist has ONE definition: @slydr/shared (T004), which the server
// (T016/T017) also uses. These are thin aliases so client call sites keep short names;
// never re-declare the numbers here.
export type ThumbSize = ThumbnailSize;
export const THUMB_SIZES: readonly ThumbSize[] = THUMBNAIL_SIZES;
export const DEFAULT_THUMB_SIZE: ThumbSize = DEFAULT_THUMBNAIL_SIZE;

export function getHealth(signal?: AbortSignal): Promise<HealthResponse>;
export function getRoot(signal?: AbortSignal): Promise<RootResponse>;

export function list(
  params: { path: string; showHidden?: boolean },
  signal?: AbortSignal,
): Promise<ListResponse>;

export function getImages(
  params: { path: string; recursive?: boolean; showHidden?: boolean },
  signal?: AbortSignal,
): Promise<ImagesResponse>;

export function imageUrl(path: string): string;
export function thumbUrl(path: string, size?: ThumbSize): string;

/**
 * Fetches the bytes of one thumbnail. The ONLY function in the client that
 * fetches thumbnails (T027's queue calls it), which keeps `fetch` confined to
 * this file (NFR-9 guard, section 4.8). Resolves with the WebP blob.
 * Non-2xx and malformed responses reject with ApiClientError (READ_FAILED for
 * a body that is not an error envelope); a cancelled request rejects with an
 * abort error (isAbortError), never an ApiClientError.
 */
export function fetchThumbnailBlob(
  path: string,
  size?: ThumbSize,
  signal?: AbortSignal,
): Promise<Blob>;
```

URL construction rules. Do not use `URLSearchParams` and do not use the `URL` class (it needs a base for relative URLs and would invite an absolute origin to creep in). Build strings by hand with one helper:

```ts
function encode(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    // Lone surrogate (valid on NTFS, so it can arrive in a JSON file name):
    // encodeURIComponent throws URIError. Replace with U+FFFD and retry.
    return encodeURIComponent(value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�'));
  }
}

function url(endpoint: string, query: Array<[string, string]>): string {
  return `${endpoint}?${query.map(([k, v]) => `${k}=${encode(v)}`).join('&')}`;
}
```

The exact outputs (query parameter order is part of the contract, so tests can compare whole strings):

| Call | URL |
|---|---|
| `getHealth()` | `/api/health` |
| `getRoot()` | `/api/fs/root` |
| `list({ path: 'Pictures/2024', showHidden: true })` | `/api/fs/list?path=Pictures%2F2024&showHidden=true` |
| `list({ path: '' })` | `/api/fs/list?path=&showHidden=false` |
| `getImages({ path: 'Pictures', recursive: true })` | `/api/fs/images?path=Pictures&recursive=true&showHidden=false` |
| `imageUrl('My Pics/a#b%c.jpg')` | `/api/image?path=My%20Pics%2Fa%23b%25c.jpg` |
| `thumbUrl('a.jpg')` | `/api/thumb?path=a.jpg&size=256` |
| `thumbUrl('a.jpg', 128)` | `/api/thumb?path=a.jpg&size=128` |

Details:

- Booleans are always serialised explicitly as the strings `"true"` or `"false"`, with the defaults `showHidden = false` and `recursive = false`. They are never omitted, so the request is self-describing and a cached URL never depends on a server default.
- `path` is always sent, including as the empty string for the jail root (`path=`).
- Spaces become `%20` (as `encodeURIComponent` does), never `+`. `#` becomes `%23`, `%` becomes `%25`, `/` becomes `%2F`, `?` and `&` are encoded, and non-ASCII characters are UTF-8 percent-encoded (`é` becomes `%C3%A9`; an emoji becomes four encoded bytes). Express decodes all of these into the original string.
- `imageUrl` and `thumbUrl` return URL strings for `src` attributes. They perform no request, never throw (hence the lone-surrogate handling in `encode`), and always begin with `/api/`.
- **Decision (not specified):** `thumbUrl` with a size outside `THUMB_SIZES` (possible only through a type cast) silently uses `DEFAULT_THUMB_SIZE` rather than throwing in a render path or emitting a request the server will answer with `400 INVALID_PARAM`.
- The functions return the parsed `@slydr/shared` type directly, not a wrapper.
- `fetchThumbnailBlob(path, size = DEFAULT_THUMB_SIZE, signal)` requests exactly `thumbUrl(path, size)` (same size fallback rule), with `method: 'GET'`, `headers: { Accept: 'image/webp' }`, `credentials: 'same-origin'`, `cache: 'default'` (so the server's `Cache-Control: private, max-age=604800` and `ETag` apply) and the given signal. It goes through the same request core as the JSON endpoints (section 4.4 steps 1 to 3), then returns `await response.blob()`. A `blob()` failure caused by an abort is rethrown as an abort error; any other failure becomes `ApiClientError('READ_FAILED', 'Unexpected response from the Slydr server.', response.status)`. It does not validate the blob's content type.

### 4.4 The request core and error conversion

Steps 1 to 3 below (issue the request, convert a rejection, convert a non-2xx response) live in one shared internal function, so that every endpoint, including `fetchThumbnailBlob`, converts failures identically:

```ts
async function requestOk(target: string, accept: string, signal?: AbortSignal): Promise<Response>
```

`requestOk` resolves with a 2xx `Response` and otherwise throws as specified in steps 2 and 3; the `Accept` header value is the `accept` parameter (`application/json` for the JSON endpoints, `image/webp` for thumbnails). Steps 4 and 5 are specific to `getJson`; `fetchThumbnailBlob` takes `response.blob()` instead. Every JSON endpoint goes through:

```ts
async function getJson<T>(
  target: string,
  validate: (body: unknown) => body is T,
  signal?: AbortSignal,
): Promise<T>
```

Numbered behaviour:

1. Call `fetch(target, { method: 'GET', headers: { Accept: accept }, credentials: 'same-origin', signal })` (`accept` is `application/json` for `getJson`). `target` is always a relative `/api/...` string.
2. **Fetch rejects.** If `isAbortError(err)` or `signal?.aborted` is true, the request was cancelled: rethrow the original error if it is an abort error, otherwise throw `new DOMException('The operation was aborted.', 'AbortError')`. Do not wrap it in `ApiClientError`. (`signal.aborted` is checked because `controller.abort(reason)` with a custom reason makes `fetch` reject with that reason, which need not be named `AbortError`.) Any other rejection (in browsers a `TypeError`, for example connection refused or offline) becomes `new ApiClientError('READ_FAILED', 'Could not reach the Slydr server.', 0)`. The message string is exact. There is no separate network error code; screens must not map this to a code of their own.
3. **Non-2xx response.** Read the body as text, then try to parse it as an error envelope:
   - If it parses to an object whose `error` is an object with a string `message` and a `code` that is a known `ApiErrorCode`, throw `new ApiClientError(code, message, response.status)`.
   - If the envelope is well formed but the `code` is not in the union (a newer server), or if the body is empty, not JSON, HTML, or has any other shape, throw `new ApiClientError('READ_FAILED', 'Unexpected response from the Slydr server.', response.status)`. This also covers a Vite dev proxy returning a bare `500` or `502` when the Express process is not running, and any intermediary's error page.
   - If reading the body is interrupted by an abort, rethrow the abort as in step 2.
   - **Decision (not specified):** every malformed error body maps to code `READ_FAILED`, not to a code guessed from the status; the real HTTP status is preserved in `status` for callers that care. Guessing `NOT_FOUND` from a proxy's 404 would send the explorer down the "folder no longer exists" path for what is really an infrastructure problem.
4. **2xx response.** Parse `response.json()`. If parsing throws (the SPA's `index.html` served with status 200 for an unknown route is the classic case), throw `new ApiClientError('READ_FAILED', 'Unexpected response from the Slydr server.', response.status)`; if the failure is an abort, rethrow the abort. Then apply `validate` (section 4.5); a failed check throws the same `READ_FAILED` error with the real status.
5. Return the validated body.

Known-code check: keep a local table typed so that the compiler fails if the shared union changes:

```ts
const KNOWN_CODES: Record<ApiErrorCode, true> = {
  INVALID_PATH: true, INVALID_PARAM: true, OUTSIDE_ROOT: true, FORBIDDEN_HOST: true,
  NOT_FOUND: true, NOT_A_DIRECTORY: true, NOT_A_FILE: true, ACCESS_DENIED: true,
  UNSUPPORTED_IMAGE: true, THUMBNAIL_FAILED: true, READ_FAILED: true, METHOD_NOT_ALLOWED: true,
};
function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_CODES, value);
}
```

`hasOwnProperty` matters: `'constructor' in KNOWN_CODES` would otherwise be true.

Abort detection, exported:

```ts
export function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null &&
    (value as { name?: unknown }).name === 'AbortError'
  );
}
```

It checks the `name` rather than `instanceof DOMException` so it is realm-independent (jsdom's `DOMException` is not Node's). An `ApiClientError` is never an abort error, and an abort error is never an `ApiClientError`. **An aborted request must never be shown to the user:** every call site in a `catch` does `if (isAbortError(err)) return;` before touching error state. Supply the matching constructor for tests and the helper:

```ts
export function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}
```

### 4.5 Success-response validation

**Decision (not specified): validate the shape of success responses lightly, rather than blindly trusting the types.** The cost is a few property checks per call; the benefit is that a `200` carrying the wrong thing (the SPA fallback page, an old server version, another service squatting on the port) becomes a clean `READ_FAILED` instead of a `TypeError: cannot read properties of undefined` deep inside a component. The checks are top level only. Per-entry validation of `entries` and `items` is deliberately skipped, since `ImagesResponse` can hold 20 000 items (MAX_IMAGES) and the server is the trusted source of those records.

- `isHealthResponse`: object, `status === 'ok'`, `typeof version === 'string'`.
- `isRootResponse`: object, string `path`, `name`, `absoluteRoot`, `platform`.
- `isListResponse`: object; string `path`, `name`; `parentPath` is a string or `null`; `Array.isArray(entries)`; `counts` is an object with numeric `folders`, `images`, `files`; `typeof truncated === 'boolean'`.
- `isImagesResponse`: object; string `path`; boolean `recursive`; number `count`; boolean `truncated`; `Array.isArray(items)`.

Write each as a type predicate in `client.ts` (not exported) next to a small `isRecord(value): value is Record<string, unknown>` helper.

### 4.6 The two abort use cases

The signal parameter exists for exactly these two screens (spec §6.5). Both use `useAbortableRequest` (section 4.7) rather than managing controllers by hand. Show both as usage in the module's doc comment:

1. **Explorer re-navigation (T026).** The user double-clicks a folder, then a second folder before the first listing returned. The explorer issues `run((signal) => list({ path, showHidden }, signal))` through `useAbortableRequest`; the previous request is aborted, its `AbortError` is ignored with `isAbortError`, and only the latest response is rendered.
2. **Configuration `includeSubfolders` toggled twice quickly (T029).** Each toggle aborts the pending `getImages({ path, recursive, showHidden }, signal)` before starting the next, so a slow recursive scan for the old setting can never overwrite the result for the current one (and the server stops pointless work when the connection closes).

### 4.7 `useAbortableRequest` (required helper)

**This helper is required.** The explorer's `useDirectoryListing` (T026) and the configuration screen's `useImageScan` (T029) both use it, so abort bookkeeping (abort the previous request, ignore a late response, abort on unmount) exists exactly once. Neither screen creates its own `AbortController` for API calls.

```ts
// client/src/api/useAbortableRequest.ts
export interface AbortableRequest {
  /**
   * Aborts the previous request started through this hook, then runs `run`
   * with a fresh signal. Rejects with an AbortError if this request was
   * superseded, cancelled or the component unmounted, even when `run` itself
   * resolved first. Callers ignore that rejection with isAbortError.
   */
  run: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /** Aborts the in-flight request, if any. */
  cancel: () => void;
}
export function useAbortableRequest(): AbortableRequest;
```

Behaviour:

1. Keep the current `AbortController` in a ref.
2. `run` aborts the existing controller, creates a new one, stores it, awaits `task(controller.signal)`, and **then checks `controller.signal.aborted`**: if it was aborted while the response was being delivered (the abort lost the race with an already-resolved fetch), throw `createAbortError()` instead of returning the stale value. Without this check, a superseded response can still overwrite the newer one.
3. `cancel` aborts the current controller.
4. An effect cleanup aborts the current controller on unmount, which also makes React StrictMode's simulated unmount safe: the next `run` after the remount simply creates a new controller.
5. `run` and `cancel` have stable identities (`useCallback` with empty dependencies), so callers may list them in `useEffect` dependency arrays (`react-hooks/exhaustive-deps` is `error` in this repo) without re-running the effect on every render.

Example (configuration screen, for the doc comment):

```ts
const { run } = useAbortableRequest();
useEffect(() => {
  run((signal) => getImages({ path, recursive: config.includeSubfolders, showHidden }, signal))
    .then(setResult)
    .catch((err) => { if (!isAbortError(err)) setError(err); });
}, [path, config.includeSubfolders, showHidden, run]);
```

### 4.8 NFR-9: no request to anything but the local API

Three layers, all required:

1. **Construction:** `client.ts` has no base URL, no `import.meta.env` URL, no `http`/`https` literal. Every target begins with `/api/` and is relative, so the browser resolves it against the page's own origin. There is no CORS because there is no cross-origin request.
2. **Static scan test** (`client/test/no-outbound-requests.test.ts`): walks `client/src` (all tests live in `client/test/`, so no test files are in the walked tree; still skip any `*.test.ts(x)` defensively) and `client/index.html`, and fails if any file contains `http://` or `https://` (the one allowed exception is the SVG namespace literal `http://www.w3.org/`), a protocol-relative `//host` in a `src`/`href`/`url(` position of `index.html`, or any use of `XMLHttpRequest`, `WebSocket`, `EventSource` or `navigator.sendBeacon`; and fails if `fetch(` appears in any file under `client/src` other than `client/src/api/client.ts`. This includes the thumbnail queue of T027, which must call `fetchThumbnailBlob` rather than `fetch`. This also catches a font or script `<link>` to an external CDN added to `index.html`, which would breach NFR-9 as surely as a `fetch`. Resolve paths with `fileURLToPath(new URL('../src', import.meta.url))` and `node:path`, so it behaves identically on Windows, macOS and Linux (normalise separators with `path.sep` when comparing).
3. **ESLint:** in the root ESLint 9 flat config add an entry scoped to `client/src/**/*.{ts,tsx}` with `ignores` for `client/src/api/client.ts` and `**/*.test.{ts,tsx}`:

   ```js
   {
     files: ['client/src/**/*.{ts,tsx}'],
     ignores: ['client/src/api/client.ts', '**/*.test.{ts,tsx}'],
     rules: {
       'no-restricted-globals': ['error',
         { name: 'fetch', message: 'Use client/src/api/client.ts (NFR-9: local API only).' },
         { name: 'XMLHttpRequest', message: 'Use client/src/api/client.ts.' },
         { name: 'WebSocket', message: 'No sockets: NFR-9.' },
         { name: 'EventSource', message: 'No event streams: NFR-9.' },
       ],
     },
   },
   ```

   Keep this entry after the general client configuration so it is not overridden.

### 4.9 Cross-platform notes

- No Node-specific code in the client module; it uses only `fetch`, `AbortSignal`, `DOMException` and string functions.
- Do not assume `Response` exists in the test environment beyond what Node 22 provides; the test helper in section 6 builds responses explicitly.
- Windows file names may contain lone UTF-16 surrogates; that is the reason for the guarded `encode` helper. macOS file names are NFD-normalised by the file system; the client passes names through byte-for-byte and never normalises them.

## 5. Acceptance criteria

- [ ] `client/src/api/client.ts` exports `getHealth`, `getRoot`, `list`, `getImages`, `imageUrl`, `thumbUrl`, `fetchThumbnailBlob`, `ThumbSize`, `THUMB_SIZES`, `DEFAULT_THUMB_SIZE`, `ApiClientError`, `ApiError` (alias), `isApiClientError`, `isAbortError` and `createAbortError`, with the signatures in section 4.3.
- [ ] `fetchThumbnailBlob` requests exactly `thumbUrl(path, size)` with `Accept: image/webp`, resolves with the response blob on 2xx, rejects with the same `ApiClientError` mapping as the JSON endpoints on an error envelope, an unknown body or a network failure, and rejects with an abort error (not an `ApiClientError`) when its signal aborts.
- [ ] No `ApiClientError` carries a code outside `ApiErrorCode`; no `'NETWORK'` code exists anywhere in the client.
- [ ] `thumbUrl`'s `size` parameter has the type `128 | 256 | 384 | 512` and defaults to `256`; passing any other number through a cast yields `size=256`.
- [ ] The URL table in section 4.3 is reproduced exactly by the six builders/functions (verified with a mocked `fetch` and direct calls).
- [ ] Booleans are always sent as `"true"` or `"false"`, including defaults.
- [ ] A path containing a space, `#`, `%`, `?`, `&`, a non-ASCII character and an astral-plane emoji round-trips through `decodeURIComponent` to the original string; a path with a lone surrogate does not throw.
- [ ] Every URL the module produces starts with `/api/` and contains no `://` and no leading `//`.
- [ ] A well-formed error envelope with a known code becomes an `ApiClientError` carrying that `code`, the server's `message` and the HTTP `status`, for statuses 400, 403, 404, 405, 415 and 500.
- [ ] An error body that is not JSON, is empty, is an HTML page, has no `error` object, or carries an unknown `code` becomes an `ApiClientError` with code `READ_FAILED`, message `Unexpected response from the Slydr server.` and the real HTTP status.
- [ ] A `200` response whose body is not valid JSON, or whose JSON fails the structural check, becomes the same `READ_FAILED` error.
- [ ] A `fetch` that rejects with a `TypeError` becomes an `ApiClientError` with code `READ_FAILED`, status `0`, and message exactly `Could not reach the Slydr server.`
- [ ] An aborted request rejects with an error for which `isAbortError` is true, which is not an `ApiClientError`, for each of: abort during `fetch`, an already-aborted signal, abort with a custom non-`AbortError` reason, and abort while the body is being read.
- [ ] `isAbortError` returns `false` for an `ApiClientError`, a `TypeError`, `null` and a string.
- [ ] `useAbortableRequest` (required; consumed by T026 and T029) aborts the previous request when `run` is called again, rejects a superseded request with an abort error even if its task resolved, aborts on unmount, and offers `cancel`; `run` and `cancel` are referentially stable.
- [ ] `client/test/no-outbound-requests.test.ts` passes, and fails when a deliberate `https://example.com` literal or a stray `fetch(` (in any file other than `client/src/api/client.ts`) is temporarily added to a source file (verify once by hand).
- [ ] The ESLint restriction is in place: a `fetch(` call in a component under `client/src/screens` fails `npm run lint`.
- [ ] No ESLint or TypeScript suppression comments were added to `client.ts`.

## 6. Tests to write

Per spec §12.3 and NFR-9. All run in Vitest with `jsdom`; `fetch` is replaced with a mock, never the network. Tests live under `client/test/` (mirroring `src/`) and import `describe`, `it`, `expect`, `vi` from `'vitest'`.

### Test helper `client/test/helpers/fetchMock.ts`

The helper file starts with `import { vi } from 'vitest';` (Vitest globals are off).

```ts
export interface FakeResponseInit { status?: number; body?: string; headers?: Record<string, string> }

/** Builds a minimal Response-compatible object so tests do not depend on the
 *  runtime's Response implementation. */
export function fakeResponse(init: FakeResponseInit): Response;

export function jsonResponse(status: number, body: unknown): Response;     // JSON.stringify(body)
export function textResponse(status: number, text: string): Response;      // e.g. an HTML error page

/** Installs vi.fn() as global fetch (via vi.stubGlobal) and returns it. No manual
 *  cleanup: T002 sets `unstubGlobals: true`, so the stub is removed after each test. */
export function installFetchMock(): ReturnType<typeof vi.fn>;

/** A fetch implementation that stays pending until the request's signal aborts,
 *  then rejects with a DOMException named AbortError. */
export function pendingUntilAborted(): (input: RequestInfo, init?: RequestInit) => Promise<Response>;
```

`fakeResponse` implements `ok`, `status`, `text()` and `json()` (rejecting with a `SyntaxError` for invalid JSON, like the real one). If the runtime's `Response` is available and behaves, using `new Response(body, { status })` inside the helper is fine, but keep it behind this helper.

### `client/test/api/client.test.ts`

```
describe('URL construction')
  it('getHealth requests /api/health')
  it('getRoot requests /api/fs/root')
  it('list sends path and an explicit showHidden=false by default')
  it('list serialises showHidden=true')
  it('list sends an empty path as "path="')
  it('getImages sends path, recursive and showHidden in that order')
  it('getImages serialises recursive=true and showHidden=true as the strings "true"')
  it('never serialises a boolean as 1, 0, on, off or omits it')
  it('encodes spaces as %20 and never as +')
  it('encodes #, %, ?, & and / inside a path')
  it('UTF-8 percent-encodes accented characters and emoji')
  it('round-trips awkward paths through decodeURIComponent')
  it('does not throw for a path containing a lone surrogate')
  it('imageUrl returns /api/image?path=... without performing a request')
  it('thumbUrl defaults to size 256')
  it('thumbUrl accepts 128, 256, 384 and 512')
  it('thumbUrl falls back to 256 for a size outside the allowlist')
  it('every produced URL starts with /api/ and contains no scheme or protocol-relative prefix')
  it('passes credentials same-origin, method GET and an Accept: application/json header')

describe('success parsing')
  it('returns the parsed HealthResponse')
  it('returns the parsed RootResponse')
  it('returns the parsed ListResponse including parentPath null at the root')
  it('returns the parsed ImagesResponse')
  it('rejects a 200 response with an HTML body as READ_FAILED with status 200')
  it('rejects a 200 list response missing entries as READ_FAILED')
  it('rejects a 200 images response whose items is not an array as READ_FAILED')
  it('does not validate individual entries or items')

describe('error envelope conversion')
  it.each(statusTable)('maps %s %s to an ApiClientError with that code and status')
    // 400 INVALID_PATH, 400 INVALID_PARAM, 400 NOT_A_DIRECTORY, 403 OUTSIDE_ROOT,
    // 403 ACCESS_DENIED, 404 NOT_FOUND, 405 METHOD_NOT_ALLOWED, 415 UNSUPPORTED_IMAGE,
    // 500 READ_FAILED, 500 THUMBNAIL_FAILED
  it('carries the server message verbatim')
  it('is an instance of ApiClientError and of the ApiError alias, and of Error')
  it('maps an unknown error code to READ_FAILED with the real status')
  it('maps a non-JSON error body to READ_FAILED with the real status')
  it('maps an empty error body (a bare proxy 502) to READ_FAILED with status 502')
  it('maps an HTML error page to READ_FAILED')
  it('maps JSON without an error object to READ_FAILED')
  it('does not treat a code such as "constructor" or "toString" as known')

describe('network failure')
  it('maps a fetch TypeError to READ_FAILED with status 0')
  it('uses the exact message "Could not reach the Slydr server."')

describe('abort handling')
  it('rejects with an AbortError when the signal aborts during fetch')
  it('rejects with an AbortError for an already-aborted signal')
  it('rejects with an AbortError when aborted with a custom reason')
  it('rejects with an AbortError when aborted while the body is being read')
  it('does not wrap an abort in an ApiClientError')
  it('isAbortError is true for DOMException AbortError and for a plain object with that name')
  it('isAbortError is false for ApiClientError, TypeError, null, undefined and a string')

describe('abort use cases (spec §6.5)')
  it('lets the explorer abort a pending list and ignore it when a second list is issued')
  it('lets the configuration screen abort a pending getImages when includeSubfolders is toggled twice')

describe('fetchThumbnailBlob')
  it('requests thumbUrl(path, size) with method GET, Accept image/webp and credentials same-origin')
  it('defaults to size 256 and falls back to 256 for a size outside the allowlist')
  it('resolves with the response blob on a 200')
  it('maps a 500 THUMBNAIL_FAILED envelope to an ApiClientError with that code and status')
  it('maps a 415 UNSUPPORTED_IMAGE envelope to an ApiClientError with that code and status')
  it('maps a non-JSON error body to READ_FAILED with the real status')
  it('maps a fetch TypeError to READ_FAILED with status 0')
  it('rejects with an AbortError, not an ApiClientError, when the signal aborts during fetch')
  it('rejects with an AbortError when aborted while the body is being read')
  it('every request URL starts with /api/thumb?path=')
```

### `client/test/api/useAbortableRequest.test.tsx`

```
describe('useAbortableRequest')
  it('passes a live signal to the task')
  it('aborts the previous request when run is called again')
  it('rejects the superseded request with an AbortError')
  it('rejects a superseded request with an AbortError even when its task had already resolved')
  it('resolves the latest request normally')
  it('cancel aborts the in-flight request')
  it('aborts the in-flight request on unmount')
  it('keeps run and cancel referentially stable across renders')
  it('works after a StrictMode simulated unmount and remount')
```

### `client/test/no-outbound-requests.test.ts`

```
describe('NFR-9 no outbound requests')
  it('contains no http(s):// literal in client source, apart from the SVG namespace')
  it('contains no external script, stylesheet or font reference in index.html')
  it('uses fetch( only inside client/src/api/client.ts (the thumbnail queue must go through fetchThumbnailBlob)')
  it('does not use XMLHttpRequest, WebSocket, EventSource or sendBeacon')
  it('finds at least one source file (guards against a broken path making the scan vacuous)')
```

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors.
- [ ] `npm run lint` passes with no new errors, with the new `no-restricted-globals` entry active.
- [ ] New logic covered by unit tests; `npm test` green on Windows, macOS and Linux (CI matrix).
- [ ] Verified manually against the dev stack: `getRoot()` and `list({ path: '' })` succeed from the browser console through the Vite proxy; stopping the Express process makes the next call reject with `READ_FAILED`, status `0` or the proxy's `500`/`502`, never an unhandled `TypeError`.
- [ ] Verified manually in the browser Network panel that every request from the running app is to the same origin under `/api/`.
- [ ] README updated if setup or user-visible behaviour changed (expected: no change).

## 8. Notes and gotchas

- **Aborts are not errors.** The most likely bug in the screens is flashing an error banner on fast navigation. Every `catch` that touches UI state must begin with `if (isAbortError(err)) return;`. The helper in section 4.7 exists partly to make this the path of least resistance.
- **A resolved fetch can still lose a race.** Aborting after the response has been received, but before the caller processes it, does not reject anything. That is why `useAbortableRequest` re-checks `signal.aborted` after awaiting the task, and why screens using their own controllers must compare against the latest request token before applying a response.
- **Never use `URLSearchParams` for these URLs.** It encodes spaces as `+`, which the tests forbid, and its API invites passing a base URL. It also would not guard the lone-surrogate case in the same way.
- **`encodeURIComponent` throws on lone surrogates.** Windows file names can legally contain them, and a throwing URL builder in a React render path would crash the grid. Hence the guarded `encode`.
- **Messages are not copy.** The server's `message` is safe to show (spec §3.4 guarantees no paths or `errno`), but the explorer and configuration screens present their own wording chosen by `code`, so the module's synthesised English strings ("Could not reach the Slydr server.") are the only user-facing text it owns.
- **The 200-with-HTML case is real.** In production Express serves `index.html` for unknown non-API paths if the static fallback is configured loosely, and a mis-pointed dev proxy does the same. Treating it as `READ_FAILED` rather than letting a `JSON` `SyntaxError` escape is why the module catches `response.json()` failures.
- **No retries or caching here.** Retrying a `403` or `404` is pointless, and the explorer's Retry button (T026) is a deliberate user action. Browser HTTP caching still applies to `/api/image` and `/api/thumb` through the server's `Cache-Control` and `ETag` headers (spec §5.5, §5.6); the client adds nothing on top.
- **The `thumbUrl` size is a type-level allowlist.** The server enforces the same allowlist at runtime (spec §5.6), so a wrong size could only come from a cast; the silent fallback keeps the grid rendering rather than showing broken tiles.
- **Same-origin only means no `credentials: 'include'` and no `mode: 'cors'`.** `credentials: 'same-origin'` is the default and is set explicitly only so the intent is visible in review.
- **NFR-9 also covers `index.html`.** A Google Fonts `<link>` or analytics snippet would be an outbound request. The static test scans the HTML for that reason.
- **Do not export generic `fetch` wrappers for other modules.** If a future endpoint is needed, add a typed function to this file (as `fetchThumbnailBlob` does for thumbnails) so the single-choke-point guarantee (and the ESLint exception that depends on it) stays intact.
