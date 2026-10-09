/**
 * Image synthesis helpers for testing the thumbnail service.
 * Creates various image formats using sharp. Reused by T017's tests.
 * Specification §12.1.
 */

import sharp from 'sharp';
import fs from 'node:fs/promises';

/**
 * Create a JPEG with the specified orientation and color pattern:
 * left half pure red (255,0,0), right half pure blue (0,0,255).
 * Uses quality 95 so lossy WebP at quality 72 still yields clearly separable colours.
 */
export async function makeJpeg(
  file: string,
  width: number,
  height: number,
  options?: { orientation?: number },
): Promise<void> {
  // Create raw RGB buffer: left half red, right half blue
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (x < width / 2) {
        // Left half: red
        buffer[idx] = 255;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
      } else {
        // Right half: blue
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 255;
      }
    }
  }

  let transform = sharp(buffer, { raw: { width, height, channels } }).jpeg({ quality: 95 });

  if (options?.orientation) {
    transform = transform.withMetadata({ orientation: options.orientation });
  }

  await transform.toFile(file);
}

/**
 * Create a PNG with three vertical 100-px bands: red, green, blue.
 * Dimensions: 300 x 100.
 */
export async function makeBands(file: string): Promise<void> {
  const width = 300;
  const height = 100;
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (x < 100) {
        // Red band
        buffer[idx] = 255;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
      } else if (x < 200) {
        // Green band
        buffer[idx] = 0;
        buffer[idx + 1] = 255;
        buffer[idx + 2] = 0;
      } else {
        // Blue band
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 255;
      }
    }
  }

  await sharp(buffer, { raw: { width, height, channels } }).png().toFile(file);
}

/**
 * Create a 64 x 64 PNG.
 */
export async function makePng(file: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  // Fill with red
  for (let i = 0; i < buffer.length; i += channels) {
    buffer[i] = 255;
    buffer[i + 1] = 0;
    buffer[i + 2] = 0;
  }
  await sharp(buffer, { raw: { width, height, channels } }).png().toFile(file);
}

/**
 * Create a 64 x 64 GIF.
 */
export async function makeGif(file: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  // Fill with green
  for (let i = 0; i < buffer.length; i += channels) {
    buffer[i] = 0;
    buffer[i + 1] = 255;
    buffer[i + 2] = 0;
  }
  // Create as PNG then rely on extension for format detection by sharp
  await sharp(buffer, { raw: { width, height, channels } }).gif().toFile(file);
}

/**
 * Create a 64 x 64 WebP.
 */
export async function makeWebp(file: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  // Fill with blue
  for (let i = 0; i < buffer.length; i += channels) {
    buffer[i] = 0;
    buffer[i + 1] = 0;
    buffer[i + 2] = 255;
  }
  await sharp(buffer, { raw: { width, height, channels } }).webp().toFile(file);
}

/**
 * Create a 64 x 64 AVIF.
 */
export async function makeAvif(file: string): Promise<void> {
  const width = 64;
  const height = 64;
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  // Fill with yellow
  for (let i = 0; i < buffer.length; i += channels) {
    buffer[i] = 255;
    buffer[i + 1] = 255;
    buffer[i + 2] = 0;
  }
  await sharp(buffer, { raw: { width, height, channels } }).avif().toFile(file);
}

/**
 * Create a 64 x 64 SVG (as plain text).
 */
export async function makeSvg(file: string): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <rect width="64" height="64" fill="red"/>
</svg>`;
  await fs.writeFile(file, svg, 'utf8');
}

/**
 * Extract the RGB triplet at pixel (x, y) from a WebP file.
 * Returns [r, g, b] where each is 0-255.
 */
export async function pixelAt(
  webpFile: string,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data, info } = await sharp(webpFile).raw().toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const stride = info.width * channels;
  const idx = y * stride + x * channels;

  return [data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0];
}

/**
 * Fake renderer factory for testing coalescing, concurrency and error paths.
 * Returns an object with invocation count, max concurrent count, and the ability to reject.
 */
export interface FakeRendererHandle {
  renderCount: number;
  maxConcurrent: number;
  reject: (error?: Error) => void;
  resolve: () => void;
  reset: () => void;
}

/**
 * Create a fake renderer that can be gated, count invocations, and track concurrency.
 */
export function fakeRender(options?: {
  delayMs?: number;
  onStart?: () => void;
  onFinish?: () => void;
}): {
  renderer: (job: {
    absPath: string;
    size: number;
    destPath: string;
    limitInputPixels: number;
  }) => Promise<void>;
  handle: FakeRendererHandle;
} {
  let renderCount = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  let shouldReject = false;
  let rejectError: Error | undefined;
  const gates: Array<() => void> = [];

  const renderer = async (job: {
    absPath: string;
    size: number;
    destPath: string;
    limitInputPixels: number;
  }) => {
    renderCount++;
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);

    try {
      options?.onStart?.();

      // Wait for a gate if one is pending
      if (gates.length > 0) {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
      }

      if (options?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }

      if (shouldReject) {
        throw rejectError ?? new Error('Fake renderer error');
      }

      // Write a small valid WebP to the dest path
      const minWebp = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
        0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);
      await fs.writeFile(job.destPath, minWebp);

      options?.onFinish?.();
    } finally {
      concurrent--;
    }
  };

  const handle: FakeRendererHandle = {
    get renderCount() {
      return renderCount;
    },
    get maxConcurrent() {
      return maxConcurrent;
    },
    reject(error?: Error) {
      shouldReject = true;
      rejectError = error;
    },
    resolve() {
      const gate = gates.shift();
      if (gate) gate();
    },
    reset() {
      renderCount = 0;
      concurrent = 0;
      maxConcurrent = 0;
      shouldReject = false;
      rejectError = undefined;
    },
  };

  return { renderer, handle };
}

/**
 * Deferred: a promise that can be resolved/rejected from outside.
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
