import { describe, it, expect } from 'vitest';
import type {
  FsEntry,
  ImageItem,
  HealthResponse,
  RootResponse,
  ListResponse,
  ImagesResponse,
  ApiErrorEnvelope,
} from '../src/index.js';
import {
  API_ERROR_CODES,
  MAX_ENTRIES,
  MAX_DEPTH,
  MAX_IMAGES,
  THUMBNAIL_SIZES,
  DEFAULT_THUMBNAIL_SIZE,
} from '../src/index.js';

describe('limit constants', () => {
  it('fixes MAX_ENTRIES at 10000, the /api/fs/list truncation threshold', () => {
    expect(MAX_ENTRIES).toBe(10000);
  });

  it('fixes MAX_DEPTH at 12, the recursive scan depth cap', () => {
    expect(MAX_DEPTH).toBe(12);
  });

  it('fixes MAX_IMAGES at 20000, the recursive scan image cap', () => {
    expect(MAX_IMAGES).toBe(20000);
  });
});

describe('thumbnail sizes', () => {
  it('allows exactly 128, 256, 384 and 512, in ascending order', () => {
    expect(THUMBNAIL_SIZES).toEqual([128, 256, 384, 512]);
  });

  it('defaults to 256', () => {
    expect(DEFAULT_THUMBNAIL_SIZE).toBe(256);
  });

  it('includes DEFAULT_THUMBNAIL_SIZE in THUMBNAIL_SIZES', () => {
    expect(THUMBNAIL_SIZES).toContain(DEFAULT_THUMBNAIL_SIZE);
  });
});

describe('API_ERROR_CODES', () => {
  it('contains all twelve codes from the specification error table', () => {
    const expectedCodes = [
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
    ];
    expect(API_ERROR_CODES).toEqual(expectedCodes);
  });

  it('has no duplicate codes', () => {
    const uniqueCodes = new Set(API_ERROR_CODES);
    expect(uniqueCodes.size).toBe(API_ERROR_CODES.length);
  });

  it('includes FORBIDDEN_HOST and METHOD_NOT_ALLOWED, the two transport-guard codes', () => {
    expect(API_ERROR_CODES).toContain('FORBIDDEN_HOST');
    expect(API_ERROR_CODES).toContain('METHOD_NOT_ALLOWED');
  });
});

describe('contract shapes (compile-time)', () => {
  it('accepts a fully populated FsEntry for an image', () => {
    const entry: FsEntry = {
      name: 'photo.jpg',
      path: 'Pictures/photo.jpg',
      type: 'image',
      hidden: false,
      size: 1024000,
      mtimeMs: 1712345678901,
    };
    expect(entry.type).toBe('image');
  });

  it('accepts an FsEntry for a folder with null size and mtimeMs', () => {
    const entry: FsEntry = {
      name: 'MyFolder',
      path: 'Pictures/MyFolder',
      type: 'folder',
      hidden: false,
      size: null,
      mtimeMs: null,
    };
    expect(entry.size).toBeNull();
    expect(entry.mtimeMs).toBeNull();
  });

  it('accepts a ListResponse at the jail root with parentPath null', () => {
    const response: ListResponse = {
      path: '',
      name: 'PeterKin',
      parentPath: null,
      entries: [],
      counts: { folders: 0, images: 0, files: 0 },
      truncated: false,
    };
    expect(response.parentPath).toBeNull();
  });

  it('accepts a ListResponse in a subfolder with a parentPath string', () => {
    const response: ListResponse = {
      path: 'Pictures/2024',
      name: '2024',
      parentPath: 'Pictures',
      entries: [],
      counts: { folders: 0, images: 5, files: 0 },
      truncated: false,
    };
    expect(response.parentPath).toBe('Pictures');
  });

  it('accepts a truncated ListResponse', () => {
    const response: ListResponse = {
      path: 'LargeFolder',
      name: 'LargeFolder',
      parentPath: '',
      entries: [],
      counts: { folders: 5000, images: 8000, files: 5000 },
      truncated: true,
    };
    expect(response.truncated).toBe(true);
  });

  it('accepts a recursive ImagesResponse whose items carry dir wire paths', () => {
    const response: ImagesResponse = {
      path: 'Pictures',
      recursive: true,
      count: 3,
      truncated: false,
      items: [
        {
          name: 'IMG_001.jpg',
          path: 'Pictures/IMG_001.jpg',
          dir: 'Pictures',
          size: 4812345,
          mtimeMs: 1712345678901,
        },
        {
          name: 'IMG_002.jpg',
          path: 'Pictures/2024/IMG_002.jpg',
          dir: 'Pictures/2024',
          size: 5000000,
          mtimeMs: 1712345678902,
        },
        {
          name: 'IMG_003.jpg',
          path: 'Pictures/2024/IMG_003.jpg',
          dir: 'Pictures/2024',
          size: null,
          mtimeMs: null,
        },
      ],
    };
    expect(response.count).toBe(3);
    expect(response.items.length).toBe(3);
  });

  it('accepts an ImageItem whose size and mtimeMs are null', () => {
    const item: ImageItem = {
      name: 'photo_vanished.jpg',
      path: 'Pictures/photo_vanished.jpg',
      dir: 'Pictures',
      size: null,
      mtimeMs: null,
    };
    expect(item.size).toBeNull();
    expect(item.mtimeMs).toBeNull();
  });

  it('accepts a RootResponse with a Windows absoluteRoot and platform win32', () => {
    const response: RootResponse = {
      path: '',
      name: 'PeterKin',
      absoluteRoot: 'C:\\Users\\PeterKin',
      platform: 'win32',
    };
    expect(response.platform).toBe('win32');
    expect(response.absoluteRoot).toContain('Users');
  });

  it('accepts a HealthResponse whose status is the literal "ok"', () => {
    const response: HealthResponse = {
      status: 'ok',
      version: '0.1.0',
    };
    expect(response.status).toBe('ok');
  });

  it('accepts an ApiErrorEnvelope for every code in API_ERROR_CODES', () => {
    API_ERROR_CODES.forEach((code) => {
      const envelope: ApiErrorEnvelope = {
        error: {
          code,
          message: 'An error occurred',
        },
      };
      expect(envelope.error.code).toBe(code);
    });
  });
});
