import type { EntryType } from './types.js';

/**
 * IMAGE_EXTENSIONS: The single source of truth for what counts as an image (FR-2.4).
 * Nine extensions, all lower-cased and dot-prefixed, representing formats every modern
 * browser renders natively in an <img> element.
 *
 * Why HEIC/HEIF, TIFF and RAW are excluded (specification §1.2, FR-2.4):
 *
 * 1. **The player streams originals.** GET /api/image serves the file as-is via
 *    res.sendFile, and the player puts that URL in an <img> element. No browser
 *    shipping today decodes HEIC, HEIF, TIFF (beyond Safari's partial support) or
 *    camera RAW formats in an <img>. The image would simply fail to load.
 *
 * 2. **The thumbnail is not the problem — and that is the trap.** sharp can decode
 *    TIFF out of the box and HEIF in builds compiled with libheif, so a grid
 *    thumbnail would render fine. Adding .heic to the set would produce an explorer
 *    grid that looks healthy and a slide show in which every slide fails to load and
 *    is skipped (specification §9.3). The failure would appear far from its cause.
 *
 * 3. **Supporting them needs a transcoding path, not a list entry.** GET /api/image
 *    would have to detect those extensions and stream a sharp-transcoded JPEG or
 *    WebP instead of the original, giving up res.sendFile's Range, ETag,
 *    Last-Modified and 304 handling, and adding a second uncached CPU-heavy pipeline.
 *    That is a feature scoped post-v1, not a one-line change.
 *
 * Consequently .heic, .heif, .tif, .tiff, .cr2, .cr3, .nef, .arw, .dng, .orf, .rw2
 * and friends classify as 'file' and get the generic file icon. They are not an error
 * state; they are simply not playable in v1.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.svg',
]);

/**
 * Extension to MIME type for every member of `IMAGE_EXTENSIONS`. Keys are
 * lower-cased and include the leading dot.
 *
 * Three entries deserve special note:
 * - .jfif maps to image/jpeg: JFIF is the JPEG interchange format; the extension is
 *   a Windows-era variant still produced by digital cameras and some browsers.
 * - .bmp maps to image/bmp, the IANA-registered type, not the legacy image/x-ms-bmp.
 * - .svg maps to image/svg+xml: SVG is in the set because browsers render it natively
 *   in an <img> element, and sharp can rasterise it for thumbnails (specification §5.6).
 */
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/**
 * The lower-cased extension of a basename, including the leading dot, or `''`
 * when the name has no extension.
 *
 * `IMG_0001.JPG`      -> '.jpg'
 * `photo.backup.jpeg` -> '.jpeg'
 * `.gitignore`        -> ''      (leading-dot name with no second dot)
 * `README`            -> ''
 * `photo.`            -> '.'
 *
 * Algorithm:
 * 1. Find the index of the last `.` in the name.
 * 2. If that index is -1 (no dot at all), return ''.
 * 3. If that index is 0 (only dot is first character), return '' (dotfile with no extension).
 * 4. Otherwise return everything from that dot to end, lower-cased.
 * 5. A trailing dot yields '.', which is not in IMAGE_EXTENSIONS, so it classifies as 'file'.
 */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i).toLowerCase();
}

/**
 * `true` when `name`'s extension is in `IMAGE_EXTENSIONS`. Case-insensitive.
 * Takes a basename (`FsEntry.name`), not a wire path.
 */
export function isImageExtension(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

/**
 * Classify a directory entry from its basename — specification §4.1, FR-2.3.
 *
 * - a directory is always `'folder'`, whatever its name looks like;
 * - otherwise `'image'` when the lower-cased extension is in `IMAGE_EXTENSIONS`;
 * - otherwise `'file'`.
 *
 * `isDirectory` must already reflect the *resolved* target for symlinks (FR-2.1):
 * the caller resolves, this function only labels.
 */
export function classifyByName(name: string, isDirectory: boolean): EntryType {
  if (isDirectory) return 'folder';
  return isImageExtension(name) ? 'image' : 'file';
}

/**
 * The MIME type for a basename, or `null` when the extension is not a
 * supported image extension.
 */
export function mimeTypeForName(name: string): string | null {
  const ext = extensionOf(name);
  if (!Object.prototype.hasOwnProperty.call(IMAGE_MIME_TYPES, ext)) return null;
  // Indexed reads are `string | undefined` under noUncheckedIndexedAccess.
  return IMAGE_MIME_TYPES[ext] ?? null;
}
