/**
 * Typed client for the local Slydr HTTP API (spec §6.5).
 *
 * Every screen reaches the server through this module and nothing else
 * (NFR-9): one typed function per JSON endpoint, two URL builders for the
 * endpoints whose result goes straight into an `<img src>`, and
 * `fetchThumbnailBlob`, the single function through which thumbnail bytes
 * are fetched. All targets are same-origin relative URLs under `/api/`;
 * there is no base URL, no CORS, and no `fetch` anywhere else in
 * `client/src` (enforced by `client/test/no-outbound-requests.test.ts` and
 * the `no-restricted-globals` ESLint entry).
 *
 * Abort use cases (spec §6.5) — both go through `useAbortableRequest`
 * (`./useAbortableRequest`) rather than hand-rolled `AbortController`s:
 *
 * 1. Explorer re-navigation (T026). The user double-clicks a folder, then a
 *    second folder before the first listing returned. The explorer issues
 *    `run((signal) => list({ path, showHidden }, signal))`; the previous
 *    request is aborted, its `AbortError` is ignored with `isAbortError`,
 *    and only the latest response is rendered.
 * 2. Configuration `includeSubfolders` toggled twice quickly (T029). Each
 *    toggle aborts the pending
 *    `getImages({ path, recursive, showHidden }, signal)` before starting
 *    the next, so a slow recursive scan for the old setting can never
 *    overwrite the result for the current one.
 *
 * An aborted request is never an error: every `catch` that touches UI state
 * must begin with `if (isAbortError(err)) return;`.
 */

import type {
  ApiErrorCode,
  HealthResponse,
  ImagesResponse,
  ListResponse,
  RootResponse,
  ThumbnailSize,
} from '@slydr/shared';
import { DEFAULT_THUMBNAIL_SIZE, THUMBNAIL_SIZES } from '@slydr/shared';

// The thumbnail size allowlist has ONE definition: @slydr/shared (T004),
// which the server (T016/T017) also uses. These are thin aliases so client
// call sites keep short names; never re-declare the numbers here.
export type ThumbSize = ThumbnailSize;
export const THUMB_SIZES: readonly ThumbSize[] = THUMBNAIL_SIZES;
export const DEFAULT_THUMB_SIZE: ThumbSize = DEFAULT_THUMBNAIL_SIZE;

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

export function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'AbortError'
  );
}

export function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

const KNOWN_CODES: Record<ApiErrorCode, true> = {
  INVALID_PATH: true,
  INVALID_PARAM: true,
  OUTSIDE_ROOT: true,
  FORBIDDEN_HOST: true,
  NOT_FOUND: true,
  NOT_A_DIRECTORY: true,
  NOT_A_FILE: true,
  ACCESS_DENIED: true,
  UNSUPPORTED_IMAGE: true,
  THUMBNAIL_FAILED: true,
  READ_FAILED: true,
  METHOD_NOT_ALLOWED: true,
};

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_CODES, value);
}

const READ_FAILED_MESSAGE = 'Unexpected response from the Slydr server.';
const NETWORK_MESSAGE = 'Could not reach the Slydr server.';

function encode(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    // Lone surrogate (valid on NTFS, so it can arrive in a JSON file name):
    // encodeURIComponent throws URIError. Replace with U+FFFD and retry.
    return encodeURIComponent(
      value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�'),
    );
  }
}

function url(endpoint: string, query: Array<[string, string]>): string {
  return `${endpoint}?${query.map(([k, v]) => `${k}=${encode(v)}`).join('&')}`;
}

function boolString(value: boolean): string {
  return value ? 'true' : 'false';
}

function throwAbort(signal: AbortSignal | undefined, err: unknown): never {
  if (isAbortError(err)) throw err;
  if (signal?.aborted === true) throw createAbortError();
  throw err;
}

async function requestOk(
  target: string,
  accept: string,
  signal?: AbortSignal,
  extraInit?: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(target, {
      method: 'GET',
      headers: { Accept: accept },
      credentials: 'same-origin',
      signal,
      ...extraInit,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted === true) throwAbort(signal, err);
    throw new ApiClientError('READ_FAILED', NETWORK_MESSAGE, 0);
  }
  if (response.ok) return response;
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (err) {
    if (isAbortError(err) || signal?.aborted === true) throwAbort(signal, err);
    throw new ApiClientError('READ_FAILED', READ_FAILED_MESSAGE, response.status);
  }
  throw errorFromBody(bodyText, response.status);
}

function errorFromBody(bodyText: string, status: number): ApiClientError {
  if (bodyText !== '') {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (isRecord(parsed)) {
        const errorField: unknown = parsed['error'];
        if (isRecord(errorField)) {
          const code: unknown = errorField['code'];
          const message: unknown = errorField['message'];
          if (isApiErrorCode(code) && typeof message === 'string') {
            return new ApiClientError(code, message, status);
          }
        }
      }
    } catch {
      // Not JSON: fall through to the generic READ_FAILED below.
    }
  }
  return new ApiClientError('READ_FAILED', READ_FAILED_MESSAGE, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHealthResponse(body: unknown): body is HealthResponse {
  return isRecord(body) && body['status'] === 'ok' && typeof body['version'] === 'string';
}

function isRootResponse(body: unknown): body is RootResponse {
  return (
    isRecord(body) &&
    typeof body['path'] === 'string' &&
    typeof body['name'] === 'string' &&
    typeof body['absoluteRoot'] === 'string' &&
    typeof body['platform'] === 'string'
  );
}

function isListResponse(body: unknown): body is ListResponse {
  if (!isRecord(body)) return false;
  if (typeof body['path'] !== 'string' || typeof body['name'] !== 'string') return false;
  const parentPath: unknown = body['parentPath'];
  if (typeof parentPath !== 'string' && parentPath !== null) return false;
  if (!Array.isArray(body['entries'])) return false;
  const counts: unknown = body['counts'];
  if (!isRecord(counts)) return false;
  if (
    typeof counts['folders'] !== 'number' ||
    typeof counts['images'] !== 'number' ||
    typeof counts['files'] !== 'number'
  ) {
    return false;
  }
  return typeof body['truncated'] === 'boolean';
}

function isImagesResponse(body: unknown): body is ImagesResponse {
  return (
    isRecord(body) &&
    typeof body['path'] === 'string' &&
    typeof body['recursive'] === 'boolean' &&
    typeof body['count'] === 'number' &&
    typeof body['truncated'] === 'boolean' &&
    Array.isArray(body['items'])
  );
}

async function getJson<T>(
  target: string,
  validate: (body: unknown) => body is T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await requestOk(target, 'application/json', signal);
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    if (isAbortError(err) || signal?.aborted === true) throwAbort(signal, err);
    throw new ApiClientError('READ_FAILED', READ_FAILED_MESSAGE, response.status);
  }
  if (!validate(body)) {
    throw new ApiClientError('READ_FAILED', READ_FAILED_MESSAGE, response.status);
  }
  return body;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson('/api/health', isHealthResponse, signal);
}

export function getRoot(signal?: AbortSignal): Promise<RootResponse> {
  return getJson('/api/fs/root', isRootResponse, signal);
}

export function list(
  params: { path: string; showHidden?: boolean },
  signal?: AbortSignal,
): Promise<ListResponse> {
  const target = url('/api/fs/list', [
    ['path', params.path],
    ['showHidden', boolString(params.showHidden ?? false)],
  ]);
  return getJson(target, isListResponse, signal);
}

export function getImages(
  params: { path: string; recursive?: boolean; showHidden?: boolean },
  signal?: AbortSignal,
): Promise<ImagesResponse> {
  const target = url('/api/fs/images', [
    ['path', params.path],
    ['recursive', boolString(params.recursive ?? false)],
    ['showHidden', boolString(params.showHidden ?? false)],
  ]);
  return getJson(target, isImagesResponse, signal);
}

export function imageUrl(path: string): string {
  return url('/api/image', [['path', path]]);
}

function normaliseThumbSize(size: ThumbSize): ThumbSize {
  const allowed: readonly unknown[] = THUMB_SIZES;
  if (allowed.includes(size)) return size;
  return DEFAULT_THUMB_SIZE;
}

export function thumbUrl(path: string, size: ThumbSize = DEFAULT_THUMB_SIZE): string {
  const effective = normaliseThumbSize(size);
  return url('/api/thumb', [
    ['path', path],
    ['size', String(effective)],
  ]);
}

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
  size: ThumbSize = DEFAULT_THUMB_SIZE,
  signal?: AbortSignal,
): Promise<Blob> {
  return fetchThumbnailFrom(thumbUrl(path, size), signal);
}

async function fetchThumbnailFrom(target: string, signal?: AbortSignal): Promise<Blob> {
  const response = await requestOk(target, 'image/webp', signal, { cache: 'default' });
  try {
    return await response.blob();
  } catch (err) {
    if (isAbortError(err) || signal?.aborted === true) throwAbort(signal, err);
    throw new ApiClientError('READ_FAILED', READ_FAILED_MESSAGE, response.status);
  }
}
