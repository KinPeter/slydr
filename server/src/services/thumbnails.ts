/**
 * Thumbnail service: sharp-based pipeline with on-disk content-addressed cache.
 *
 * This module produces cached WebP thumbnails for images with bounded CPU, memory and
 * disk usage. A semaphore caps concurrent renders; in-flight coalescing merges burst
 * requests; atomic rename guarantees no partial files are visible to readers.
 *
 * Specification: §5.6 (D4), §12.1, §3.5, NFR-3, NFR-5, A4.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { SharpOptions } from 'sharp';
import { THUMBNAIL_SIZES as SHARED_THUMBNAIL_SIZES } from '@slydr/shared';
import type { ThumbnailSize } from '@slydr/shared';
import { ApiError } from '../middleware/errorEnvelope.js';
import { errorFields, type Logger } from '../logger.js';

/**
 * Cache key is the first 32 hex characters of sha256(absPath|mtimeMs|fileSize|size|PIPELINE_VERSION).
 * Bumping this constant invalidates all prior cache entries so stale thumbnails are not served.
 *
 * Decision (not specified): Bump this when the pipeline changes (resize fit, quality, effort,
 * orientation handling, output format, SVG density, etc.) or on sharp major/minor upgrades
 * that visibly change encoder output. Incrementing it changes every key, making old files
 * unreachable and collected by the sweep (T018).
 */
export const PIPELINE_VERSION = 1;

/**
 * The default input pixel limit enforced by sharp. Explicit so the policy is visible and testable.
 * 268402689 = 16383 x 16383, also sharp's default.
 */
export const DEFAULT_LIMIT_INPUT_PIXELS = 268402689;

/**
 * Type guard: isThumbnailSize(value) iff value is in THUMBNAIL_SIZES.
 * Rejects 256.5, '256', 0, NaN, Infinity, undefined, null, etc.
 */
export function isThumbnailSize(value: unknown): value is ThumbnailSize {
  return (SHARED_THUMBNAIL_SIZES as readonly unknown[]).includes(value);
}

export interface ThumbnailRequest {
  /** Verified absolute path from resolveSafe (T017's job). */
  absPath: string;
  /** Validated as a member of THUMBNAIL_SIZES. */
  size: ThumbnailSize;
}

export interface ThumbnailResult {
  /** Absolute path of <cacheDir>/<key[0..1]>/<key>.webp. */
  filePath: string;
  /** 32 lowercase hex characters; T017 uses it as the strong ETag. */
  key: string;
  /** true if served from an existing cache file, false if rendered (or coalesced onto a render). */
  cached: boolean;
}

/**
 * Compute the cache key: sha256(absPath|mtimeMs|fileSize|size|PIPELINE_VERSION),
 * hex digest, first 32 characters.
 */
export function computeThumbnailKey(input: {
  absPath: string;
  mtimeMs: number;
  fileSize: number;
  size: number;
}): string {
  return createHash('sha256')
    .update(`${input.absPath}|${input.mtimeMs}|${input.fileSize}|${input.size}|${PIPELINE_VERSION}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Pure function: given cacheDir and a cache key, return the absolute path of the final cached file.
 * This is the only place the on-disk layout is encoded.
 */
export function thumbnailPathFor(cacheDir: string, key: string): string {
  return path.join(cacheDir, key.slice(0, 2), `${key}.webp`);
}

/**
 * Default concurrency limit: min(4, os.availableParallelism()).
 * Specification §5.6, NFR-3: bounds memory and CPU on multi-core machines.
 */
export function defaultConcurrency(parallelism = os.availableParallelism()): number {
  return Math.max(1, Math.min(4, Math.floor(parallelism) || 1));
}

/**
 * Semaphore: FIFO counting semaphore for resource pooling.
 * Specification §4.7.
 */
export class Semaphore {
  private readonly limit: number;
  private activeCount: number = 0;
  private waitingCount: number = 0;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`Semaphore limit must be an integer >= 1, got ${limit}`);
    }
    this.limit = limit;
  }

  /**
   * Acquire a permit, run the task, then release. Waiters are served FIFO.
   * The permit is released in a finally, so a rejecting task never leaks it.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.activeCount >= this.limit) {
      // Queue a waiter
      this.waitingCount++;
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
      this.waitingCount--;
    }

    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /** Current number of active tasks. */
  get active(): number {
    return this.activeCount;
  }

  /** Current number of waiting tasks. */
  get waiting(): number {
    return this.waitingCount;
  }
}

/**
 * Sharp input options for the pipeline: failOn 'none' to tolerate recoverable corruption,
 * the pixel limit, and density: 96 for SVG files.
 */
export function sharpInputOptions(absPath: string, limitInputPixels: number): SharpOptions {
  const options: SharpOptions = { failOn: 'none', limitInputPixels };
  if (path.extname(absPath).toLowerCase() === '.svg') {
    options.density = 96;
  }
  return options;
}

/**
 * The default render function: the sharp pipeline exactly as specified.
 * Specification §4.5.
 */
export async function renderThumbnail(job: {
  absPath: string;
  size: ThumbnailSize;
  destPath: string;
  limitInputPixels: number;
}): Promise<void> {
  configureSharp();
  const opts = sharpInputOptions(job.absPath, job.limitInputPixels);
  await sharp(job.absPath, opts)
    .rotate()
    .resize(job.size, job.size, { fit: 'cover', position: 'centre' })
    .webp({ quality: 72, effort: 4 })
    .toFile(job.destPath);
}

/**
 * Configure sharp globally. Idempotent (set flag). Called lazily on first render.
 *
 * Decision (not specified): sharp.cache(false) because this workload decodes each source
 * once and never reuses it. On Windows, libvips's file cache can keep source images open,
 * blocking the user from deleting/moving a photo after its thumbnail was made. Disabling
 * the cache removes that hazard.
 *
 * Decision (not specified): sharp.concurrency(n) divides cores among permitted concurrent
 * renders to avoid 4x oversubscription on a 4-core machine (4 renders × all cores each).
 */
export function configureSharp(): void {
  sharp.cache(false);
  const n = Math.max(1, Math.floor(os.availableParallelism() / defaultConcurrency()));
  sharp.concurrency(n);
}

export type RenderFunction = (job: {
  absPath: string;
  size: ThumbnailSize;
  destPath: string;
  limitInputPixels: number;
}) => Promise<void>;

export interface ThumbnailServiceOptions {
  /** Required, absolute: ServerConfig.cacheDir (resolved by T008). */
  cacheDir: string;
  /** Logger for thumb.generated (debug) and thumb.failed (warn). Default: no-op. */
  logger?: Logger;
  /** Concurrent render limit. Default: defaultConcurrency(). */
  concurrency?: number;
  /** Input pixel limit. Default: DEFAULT_LIMIT_INPUT_PIXELS. */
  limitInputPixels?: number;
  /** Custom render function for testing. Default: renderThumbnail (the sharp pipeline). */
  render?: RenderFunction;
  /** Custom fs.rename for testing. Default: fs.promises.rename. */
  rename?: (from: string, to: string) => Promise<void>;
  /** Clock override for testing. Default: Date.now. */
  now?: () => number;
  /** Touch interval (ms) for cache hits. Default: 1 hour. */
  touchIntervalMs?: number;
}

export interface ThumbnailService {
  getThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult>;
  readonly cacheDir: string;
  /** Diagnostics: current in-flight render count. */
  inflightCount(): number;
}

/**
 * Create a thumbnail service instance. No module-level state; all options and
 * state belong to the instance. This allows tests to create isolated instances
 * with temporary cache directories.
 */
export function createThumbnailService(options: ThumbnailServiceOptions): ThumbnailService {
  // Validate cacheDir
  if (!path.isAbsolute(options.cacheDir)) {
    throw new Error(`cacheDir must be an absolute path, got: ${options.cacheDir}`);
  }

  const cacheDir = options.cacheDir;
  const logger = options.logger ?? { debug() {}, info() {}, warn() {}, error() {} };
  const concurrency = options.concurrency ?? defaultConcurrency();
  const limitInputPixels = options.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS;
  const render = options.render ?? renderThumbnail;
  const rename = options.rename ?? (async (from, to) => fs.rename(from, to));
  const now = options.now ?? (() => Date.now());
  const touchIntervalMs = options.touchIntervalMs ?? 60 * 60 * 1000; // 1 hour

  const semaphore = new Semaphore(concurrency);
  const inflight = new Map<string, Promise<ThumbnailResult>>();
  let cacheInitPromise: Promise<void> | null = null;
  let sharpConfigured = false;

  /**
   * Lazy recursive creation of the cache directory.
   */
  async function ensureCacheDir(): Promise<void> {
    if (cacheInitPromise) return cacheInitPromise;

    cacheInitPromise = (async () => {
      try {
        await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
        logger.debug('thumb.cache-created', { cacheDir });
      } catch (err) {
        cacheInitPromise = null; // Reset on failure so next request can retry
        throw err;
      }
    })();

    return cacheInitPromise;
  }

  /**
   * Sleep for a duration (used in rename retry backoff).
   */
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if a file exists without throwing.
   */
  async function exists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Configure sharp on first call, then no-op. Instance-level to avoid module state.
   */
  function ensureSharpConfigured(): void {
    if (sharpConfigured) return;
    sharpConfigured = true;
    sharp.cache(false);
    const n = Math.max(1, Math.floor(os.availableParallelism() / defaultConcurrency()));
    sharp.concurrency(n);
  }

  /**
   * Retry rename on Windows-specific transient errors.
   * Specification §4.6.
   */
  async function renameWithRetry(from: string, to: string): Promise<void> {
    const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
    const BACKOFF_MS = [25, 50, 100, 200];

    for (let attempt = 0; ; attempt++) {
      try {
        await rename(from, to);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (!code || !RETRYABLE.has(code)) throw err;

        // Content-addressed: if the destination already exists, it is byte-for-byte
        // what this render would have installed. Our temp copy is redundant.
        if (await exists(to)) {
          await fs.rm(from, { force: true });
          return;
        }

        if (attempt >= BACKOFF_MS.length) throw err;
        // noUncheckedIndexedAccess: BACKOFF_MS[attempt] is safe because attempt < BACKOFF_MS.length
        const backoff = BACKOFF_MS[attempt];
        if (backoff) await sleep(backoff);
      }
    }
  }

  /**
   * Generate a thumbnail (decode, resize, encode, write).
   * Specification §4.6 (atomic write with retry).
   */
  async function generate(job: {
    absPath: string;
    size: ThumbnailSize;
    key: string;
    finalPath: string;
  }): Promise<ThumbnailResult> {
    const shardDir = path.dirname(job.finalPath);
    const startMs = now();
    let tmpPath: string | undefined;

    try {
      // Step 1: ensure shard directory
      await fs.mkdir(shardDir, { recursive: true, mode: 0o700 });

      // Step 2: create temp file name
      const randomHex = crypto.randomBytes(6).toString('hex');
      tmpPath = path.join(shardDir, `${job.key}.${process.pid}-${randomHex}.tmp`);

      // Step 3: render inside a semaphore permit
      await semaphore.run(async () => {
        // Re-check cache hit after acquiring permit (§4.8)
        const stat = await fs
          .stat(job.finalPath)
          .then((s) => (s.size > 0 ? s : null))
          .catch(() => null);
        if (stat) {
          return; // Already rendered; skip
        }

        // Render, with shard-vanished retry (§4.6)
        // tmpPath was set before entering this async context
        if (!tmpPath) throw new Error('tmpPath not initialized');
        ensureSharpConfigured();
        let lastRenderErr: unknown;
        try {
          await render({
            absPath: job.absPath,
            size: job.size,
            destPath: tmpPath,
            limitInputPixels,
          });
        } catch (err) {
          lastRenderErr = err;
        }

        // If the render failed with ENOENT and the shard vanished, retry once
        const isEnoentErr =
          lastRenderErr &&
          typeof lastRenderErr === 'object' &&
          'code' in lastRenderErr &&
          lastRenderErr.code === 'ENOENT';
        if (isEnoentErr && !(await exists(shardDir))) {
          await fs.mkdir(shardDir, { recursive: true, mode: 0o700 });
          await render({
            absPath: job.absPath,
            size: job.size,
            destPath: tmpPath,
            limitInputPixels,
          });
        } else if (lastRenderErr) {
          throw lastRenderErr;
        }
      });

      // Step 4: atomic rename
      if (!tmpPath) throw new Error('tmpPath not initialized');
      await renameWithRetry(tmpPath, job.finalPath);

      // Success: log and return
      const elapsedMs = now() - startMs;
      const fileSize = await fs
        .stat(job.finalPath)
        .then((s) => s.size)
        .catch(() => 0);
      logger.debug('thumb.generated', {
        key: job.key,
        size: job.size,
        ms: elapsedMs,
        bytes: fileSize,
      });

      return { filePath: job.finalPath, key: job.key, cached: false };
    } catch (err) {
      // Step 5: cleanup and map error
      // Delete only the temp file we created (if it exists)
      if (tmpPath) {
        try {
          // Check if it's a file before trying to remove it
          const stat = await fs.stat(tmpPath).catch(() => null);
          if (stat && stat.isFile()) {
            await fs.rm(tmpPath, { force: true });
          }
        } catch {
          // Silently ignore cleanup errors
        }
      }

      // Map error to ApiError
      let apiErr: ApiError;
      if (err instanceof ApiError) {
        apiErr = err;
      } else {
        apiErr = new ApiError('THUMBNAIL_FAILED', 'Could not generate a thumbnail.', err);
      }

      // Log the failure (with errorFields as per spec §4.10)
      logger.warn('thumb.failed', {
        ...errorFields(err),
        key: job.key,
        size: job.size,
        absPath: job.absPath,
      });

      throw apiErr;
    }
  }

  /**
   * Touch a cache file's atime/mtime if it's older than the touch interval.
   * Specification §4.12.
   */
  async function touchIfOld(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      const age = now() - stat.mtimeMs;
      if (age > touchIntervalMs) {
        // utimes takes seconds, not milliseconds
        const timestamp = Math.floor(now() / 1000);
        // Best effort; errors are ignored
        await fs.utimes(filePath, timestamp, timestamp).catch(() => {});
      }
    } catch {
      // Ignore errors
    }
  }

  return {
    /**
     * Main entry point: return a cached thumbnail or generate one.
     */
    async getThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult> {
      // Validate size before any FS access
      if (!isThumbnailSize(request.size)) {
        throw new ApiError('INVALID_PARAM', 'Unsupported thumbnail size.');
      }

      // absPath must be absolute (caller responsibility)
      if (!path.isAbsolute(request.absPath)) {
        throw new Error(`Absolute path required, got: ${request.absPath}`);
      }

      // Ensure cache directory exists
      await ensureCacheDir();

      // Stat the source
      let sourceStat;
      try {
        sourceStat = await fs.stat(request.absPath);
      } catch (err) {
        throw new ApiError('NOT_FOUND', 'Not found.', err);
      }

      // Defensive: reject directories
      if (!sourceStat.isFile()) {
        throw new ApiError('NOT_A_FILE', 'Not a file.');
      }

      // Compute cache key
      const key = computeThumbnailKey({
        absPath: request.absPath,
        mtimeMs: sourceStat.mtimeMs ?? 0,
        fileSize: sourceStat.size,
        size: request.size,
      });

      const finalPath = thumbnailPathFor(cacheDir, key);

      // Check for cache hit
      const cacheStat = await fs
        .stat(finalPath)
        .then((s) => (s.size > 0 ? s : null))
        .catch(() => null);

      if (cacheStat) {
        // Cache hit: touch if old, return
        await touchIfOld(finalPath);
        return { filePath: finalPath, key, cached: true };
      }

      // Check for in-flight render
      if (inflight.has(key)) {
        const inflightPromise = inflight.get(key);
        if (inflightPromise) {
          const result = await inflightPromise;
          return { ...result, cached: false };
        }
      }

      // Start a new render
      const renderPromise = (async () => {
        try {
          return await generate({
            absPath: request.absPath,
            size: request.size,
            key,
            finalPath,
          });
        } finally {
          inflight.delete(key);
        }
      })();

      inflight.set(key, renderPromise);
      return renderPromise;
    },

    cacheDir,

    inflightCount(): number {
      return inflight.size;
    },
  };
}
