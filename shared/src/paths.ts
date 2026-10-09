/**
 * POSIX wire-path helpers (specification §3.2).
 *
 * A "wire path" is the string form every path takes while crossing the
 * Slydr HTTP API: forward-slash separated, always relative to the jail
 * root, and never a platform-specific or absolute path.
 *
 *   - `''` denotes the jail root itself.
 *   - `'Pictures/2024/summer'` denotes `<jail root>/Pictures/2024/summer`
 *     on every OS, including Windows.
 *
 * These functions must never see or produce a Windows path, a drive
 * letter (`C:`), a UNC prefix (`\\server\share`), a backslash separator,
 * or an absolute path of any kind. The one sanctioned exception in the
 * whole system is `RootResponse.absoluteRoot` (specification §3.2, §4
 * — defined in `types.ts`), which is a display-only string that never
 * flows back into any of the functions below.
 *
 * SECURITY NOTE: nothing in this module performs or substitutes for
 * security validation. There is no containment check here, no rejection
 * of `..`, no NUL-byte or length check. Containment is enforced
 * exclusively server-side by `resolveSafe` in
 * `server/src/security/jail.ts` (specification §3.3, ticket T010).
 * Treating any function in this file as a safety boundary is a defect:
 * a crafted wire path must reach `resolveSafe` unmodified so the jail
 * can reject it explicitly, rather than have a client-side helper
 * silently rewrite it into something that looks safe.
 */

/**
 * Normalizes a wire path: collapses runs of consecutive slashes into one,
 * strips any leading and trailing slash, and drops `.` segments. Does
 * **not** resolve or reject `..` segments — see the module-level
 * "Decision (not specified)" note below.
 */
export function normalizeWirePath(path: string): string {
  if (path === '') return '';
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  return segments.join('/');
}

/**
 * Joins a child segment onto a base wire path, producing a normalized
 * wire path. `segment` may itself contain `/` (e.g. a multi-level
 * relative append) and may be `''`, in which case the result is simply
 * `base` normalized.
 */
export function wireJoin(base: string, segment: string): string {
  if (segment === '') return normalizeWirePath(base);
  if (base === '') return normalizeWirePath(segment);
  return normalizeWirePath(`${base}/${segment}`);
}

/**
 * Returns the wire path of the parent of `path`, or `null` when `path`
 * is the jail root (`''`) — the jail root has no parent. This mirrors
 * `ListResponse.parentPath` (specification §5.3), which the explorer
 * uses to enable or disable the "up one level" control.
 */
export function wireParent(path: string): string | null {
  const normalized = normalizeWirePath(path);
  if (normalized === '') return null;
  const segments = normalized.split('/');
  segments.pop();
  return segments.join('/');
}

/**
 * Returns the final segment of a wire path — the name a folder or file
 * would show in a directory listing. Returns `''` for the jail root,
 * since the jail root's display name (`RootResponse.name`) is computed
 * server-side from the real directory name, not derived from the wire
 * path.
 */
export function wireBasename(path: string): string {
  const normalized = normalizeWirePath(path);
  if (normalized === '') return '';
  // `.at(-1)` is `string | undefined` under noUncheckedIndexedAccess; it is never
  // undefined here because `normalized` is non-empty.
  return normalized.split('/').at(-1) ?? '';
}

/**
 * Splits a wire path into its ordered path segments. Returns `[]` for
 * the jail root.
 */
export function wireSegments(path: string): string[] {
  const normalized = normalizeWirePath(path);
  if (normalized === '') return [];
  return normalized.split('/');
}

/**
 * Builds the ordered list of breadcrumb entries for `path`, for the
 * explorer's breadcrumb trail (specification §7.3). The first entry is
 * always the "Home" root, pointing at the jail root (`''`); one further
 * entry follows per path segment, each `path` being the cumulative wire
 * path up to and including that segment. The caller (a later client
 * ticket) is responsible for the collapsing-ellipsis behaviour described
 * in §7.3 when the trail is wider than the available space; this
 * function only produces the full, uncollapsed trail.
 */
export function breadcrumbSegments(path: string): { label: string; path: string }[] {
  const segments = wireSegments(path);
  const result: { label: string; path: string }[] = [{ label: 'Home', path: '' }];
  let cumulative = '';
  for (const segment of segments) {
    cumulative = wireJoin(cumulative, segment);
    result.push({ label: segment, path: cumulative });
  }
  return result;
}
