/**
 * Wire path format: POSIX-style (forward-slash), relative to the jail root (user's home
 * directory), never absolute or platform-specific. Empty string `''` denotes the jail root.
 * `type` is determined by the lower-cased extension or whether it's a directory.
 * `hidden` is computed server-side and reflects dot-file names or Windows-specific names.
 * `size` and `mtimeMs` are nullable to gracefully handle stat failures (NFR-5).
 */

export type EntryType = 'folder' | 'image' | 'file';

export interface FsEntry {
  name: string; // basename as it appears on disk
  path: string; // wire path, relative to jail root, POSIX separators
  type: EntryType;
  hidden: boolean; // see 4.3
  size: number | null; // bytes; null for folders and on stat failure
  mtimeMs: number | null;
}

/**
 * One playable image in a slide-show playlist, as returned by
 * `GET /api/fs/images`. `path` and `dir` are wire paths; `dir` is the wire
 * path of the directory containing the image and is `''` when the image sits
 * directly in the jail root.
 */
export interface ImageItem {
  name: string;
  path: string;
  dir: string;
  size: number | null;
  mtimeMs: number | null;
}

export interface EntryCounts {
  folders: number;
  images: number;
  files: number;
}

/** `GET /api/health` — specification §5.1. */
export interface HealthResponse {
  status: 'ok';
  /** The server package's version string. */
  version: string;
}

/**
 * `GET /api/fs/root` — specification §5.2. The explorer's starting point.
 */
export interface RootResponse {
  /** Always `''`: the jail root as a wire path. */
  path: string;
  /**
   * Basename of the jail root, e.g. `"PeterKin"`. Display-only (tooltip next to the
   * breadcrumb's "Home" root segment, which carries the fixed label "Home" per spec §7.3).
   */
  name: string;
  /**
   * Absolute path of the jail root, e.g. `"C:\\Users\\PeterKin"`.
   * DISPLAY ONLY (tooltip). It must never be sent
   * back to the server in any request.
   */
  absoluteRoot: string;
  /** `process.platform` of the host, e.g. `"win32"`, `"darwin"`, `"linux"`. */
  platform: string;
}

/**
 * `GET /api/fs/list` — specification §5.3. One directory's contents.
 */
export interface ListResponse {
  /** Wire path of the listed directory; `''` for the jail root. */
  path: string;
  /** Basename of the listed directory. */
  name: string;
  /**
   * Wire path of the parent directory, or `null` when `path` is the jail
   * root. The UI uses `null` to disable the "up one level" control.
   */
  parentPath: string | null;
  /**
   * Entries after hidden-filtering, sorted server-side per specification
   * §4.2 (folders first, then the numeric collator). The client must not
   * re-sort.
   */
  entries: FsEntry[];
  /** Counts of the returned (post-filter) entries. Feeds the explorer's image-count chip. */
  counts: EntryCounts;
  /**
   * `true` when the directory held more than `MAX_ENTRIES` entries. The
   * response then carries the first `MAX_ENTRIES` after sorting and the UI
   * shows a notice.
   */
  truncated: boolean;
}

/**
 * `GET /api/fs/images` — specification §5.4. The player's playlist, and the
 * single source of it: the configuration screen fetches this and hands the
 * result to the player, which performs no second fetch.
 */
export interface ImagesResponse {
  /** Wire path of the scanned directory. */
  path: string;
  /** Echo of the effective `recursive` flag, bound to the `includeSubfolders` config option. */
  recursive: boolean;
  /** `items.length`, repeated for convenience. */
  count: number;
  /** `true` when the scan stopped at `MAX_IMAGES`. */
  truncated: boolean;
  /**
   * Depth-first order: within each directory the specification §4.2
   * collator order applies, and a directory's own images precede its
   * subdirectories' images.
   */
  items: ImageItem[];
}

/**
 * Every error code the API can return — specification §3.5. The tuple is the
 * single source of truth; `ApiErrorCode` is derived from it so a code can
 * never be added to one without the other.
 *
 * Intended HTTP statuses (enforced server-side, not encoded here):
 *   INVALID_PATH        400   Malformed, absolute, or oversized path input.
 *   INVALID_PARAM       400   A query parameter failed validation.
 *   OUTSIDE_ROOT        403   Resolved target escapes the jail root.
 *   FORBIDDEN_HOST      403   Host header check failed.
 *   NOT_FOUND           404   Target does not exist.
 *   NOT_A_DIRECTORY     400   A directory was required, a file was given.
 *   NOT_A_FILE          400   A file was required, a directory was given.
 *   ACCESS_DENIED       403   OS denied read (EACCES, EPERM).
 *   UNSUPPORTED_IMAGE   415   Extension is not in the supported image set.
 *   THUMBNAIL_FAILED    500   Decode or resize failed.
 *   READ_FAILED         500   Any other I/O failure.
 *   METHOD_NOT_ALLOWED  405   Non-GET/HEAD request.
 */
export const API_ERROR_CODES = [
  'INVALID_PATH',
  'INVALID_PARAM',
  'OUTSIDE_ROOT',
  'FORBIDDEN_HOST',
  'NOT_FOUND',
  'NOT_A_DIRECTORY',
  'NOT_A_FILE',
  'ACCESS_DENIED',
  'UNSUPPORTED_IMAGE',
  'THUMBNAIL_FAILED',
  'READ_FAILED',
  'METHOD_NOT_ALLOWED',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The body of every API error response — specification §3.5. `message` is a
 * short, human-readable sentence safe to show in the UI. It must never
 * contain a raw OS error message, an `errno`, or an absolute path
 * (specification §3.4); those are logged server-side only.
 */
export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/**
 * Maximum entries returned by `GET /api/fs/list` — specification §5.3. The
 * response carries the first `MAX_ENTRIES` after sorting and sets
 * `truncated: true`. Bounds memory on pathological directories.
 */
export const MAX_ENTRIES = 10000;

/** Maximum recursion depth for `GET /api/fs/images` — specification §5.4. */
export const MAX_DEPTH = 12;

/**
 * Maximum images collected by `GET /api/fs/images` — specification §5.4. On
 * hitting it the scan stops and sets `truncated: true`.
 */
export const MAX_IMAGES = 20000;

/**
 * Allowed `size` values for `GET /api/thumb` — specification §5.6. A fixed
 * allowlist prevents cache-flooding via arbitrary sizes; any other value is
 * rejected with `400 INVALID_PARAM`.
 */
export const THUMBNAIL_SIZES = [128, 256, 384, 512] as const;

export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

/** Default `size` for `GET /api/thumb`, and the size the explorer grid requests. */
export const DEFAULT_THUMBNAIL_SIZE: ThumbnailSize = 256;
