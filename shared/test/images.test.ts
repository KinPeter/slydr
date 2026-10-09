import { describe, it, expect } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  extensionOf,
  isImageExtension,
  classifyByName,
  mimeTypeForName,
} from '../src/index.js';

describe('IMAGE_EXTENSIONS', () => {
  it('contains exactly the nine browser-renderable extensions from FR-2.4', () => {
    const expected = ['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'];
    const actual = Array.from(IMAGE_EXTENSIONS).sort();
    expect(actual).toEqual(expected.sort());
    expect(IMAGE_EXTENSIONS.size).toBe(9);
  });

  it('stores every extension lower-cased and dot-prefixed', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(ext).toMatch(/^\.[a-z]+$/);
      expect(ext).toBe(ext.toLowerCase());
    }
  });

  it('excludes HEIC, HEIF, TIFF and common RAW extensions', () => {
    const excluded = [
      '.heic',
      '.heif',
      '.tif',
      '.tiff',
      '.cr2',
      '.cr3',
      '.nef',
      '.arw',
      '.dng',
      '.orf',
      '.rw2',
      '.ico',
      '.jxl',
      '.pdf',
    ];
    for (const ext of excluded) {
      expect(IMAGE_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});

describe('IMAGE_MIME_TYPES', () => {
  it('has a MIME type for every member of IMAGE_EXTENSIONS', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(Object.prototype.hasOwnProperty.call(IMAGE_MIME_TYPES, ext)).toBe(true);
      expect(IMAGE_MIME_TYPES[ext]).toBeDefined();
    }
  });

  it('has no key that is not a member of IMAGE_EXTENSIONS', () => {
    for (const key of Object.keys(IMAGE_MIME_TYPES)) {
      expect(IMAGE_EXTENSIONS.has(key)).toBe(true);
    }
  });

  it('maps .jpg, .jpeg and .jfif all to image/jpeg', () => {
    expect(IMAGE_MIME_TYPES['.jpg']).toBe('image/jpeg');
    expect(IMAGE_MIME_TYPES['.jpeg']).toBe('image/jpeg');
    expect(IMAGE_MIME_TYPES['.jfif']).toBe('image/jpeg');
  });

  it('maps .svg to image/svg+xml, not image/svg', () => {
    expect(IMAGE_MIME_TYPES['.svg']).toBe('image/svg+xml');
  });

  it('maps .bmp to image/bmp, not image/x-ms-bmp', () => {
    expect(IMAGE_MIME_TYPES['.bmp']).toBe('image/bmp');
  });
});

describe('extensionOf', () => {
  it('returns the lower-cased extension of a simple name', () => {
    expect(extensionOf('photo.jpg')).toBe('.jpg');
    expect(extensionOf('image.png')).toBe('.png');
  });

  it('lower-cases an all-caps extension (IMG_0001.JPG -> .jpg)', () => {
    expect(extensionOf('IMG_0001.JPG')).toBe('.jpg');
  });

  it('lower-cases a mixed-case extension (a.JpG -> .jpg)', () => {
    expect(extensionOf('a.JpG')).toBe('.jpg');
  });

  it('returns the last extension of a multi-dot name (photo.backup.jpeg -> .jpeg)', () => {
    expect(extensionOf('photo.backup.jpeg')).toBe('.jpeg');
  });

  it('returns an empty string for a name with no dot', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
  });

  it('returns an empty string for a leading-dot name with no second dot (.gitignore)', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('.DS_Store')).toBe('');
    expect(extensionOf('.env')).toBe('');
  });

  it('returns a bare dot for a name ending in a dot (photo.)', () => {
    expect(extensionOf('photo.')).toBe('.');
  });

  it('returns an empty string for an empty name', () => {
    expect(extensionOf('')).toBe('');
  });

  it('does not lower-case the name itself, only the extension', () => {
    expect(extensionOf('PHOTO.JPG')).toBe('.jpg');
    expect(extensionOf('MyImage.Png')).toBe('.png');
    // The name part stays as-is
    const result = extensionOf('MyImage.Png');
    expect(result).not.toContain('MY');
  });
});

describe('isImageExtension', () => {
  it('accepts every extension in IMAGE_EXTENSIONS, in lower case', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      const basename = `file${ext}`;
      expect(isImageExtension(basename)).toBe(true);
    }
  });

  it('accepts every extension in IMAGE_EXTENSIONS, in upper case', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      const basename = `file${ext.toUpperCase()}`;
      expect(isImageExtension(basename)).toBe(true);
    }
  });

  it('accepts a dotfile that still carries an image extension (.hidden.jpg)', () => {
    expect(isImageExtension('.hidden.jpg')).toBe(true);
    expect(isImageExtension('.photo.png')).toBe(true);
  });

  it('rejects .gitignore, a leading-dot name with no extension', () => {
    expect(isImageExtension('.gitignore')).toBe(false);
  });

  it('rejects an extensionless name such as README', () => {
    expect(isImageExtension('README')).toBe(false);
  });

  it('rejects a name ending in a bare dot (photo.)', () => {
    expect(isImageExtension('photo.')).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(isImageExtension('')).toBe(false);
  });

  it('rejects a multi-dot non-image name (archive.tar.gz)', () => {
    expect(isImageExtension('archive.tar.gz')).toBe(false);
  });

  it('accepts a multi-dot image name (holiday.backup.png)', () => {
    expect(isImageExtension('holiday.backup.png')).toBe(true);
  });

  it('rejects a name whose image extension is not last (photo.jpg.txt)', () => {
    expect(isImageExtension('photo.jpg.txt')).toBe(false);
  });

  it('rejects HEIC, HEIF, TIFF and RAW names', () => {
    expect(isImageExtension('photo.heic')).toBe(false);
    expect(isImageExtension('photo.heif')).toBe(false);
    expect(isImageExtension('photo.tif')).toBe(false);
    expect(isImageExtension('photo.tiff')).toBe(false);
    expect(isImageExtension('photo.cr2')).toBe(false);
    expect(isImageExtension('photo.nef')).toBe(false);
    expect(isImageExtension('photo.arw')).toBe(false);
    expect(isImageExtension('photo.dng')).toBe(false);
  });

  it('rejects a name that merely contains an extension string (jpgfile)', () => {
    expect(isImageExtension('jpgfile')).toBe(false);
    expect(isImageExtension('filejpg')).toBe(false);
  });
});

describe('classifyByName', () => {
  it('classifies a directory as folder', () => {
    expect(classifyByName('MyFolder', true)).toBe('folder');
    expect(classifyByName('2024', true)).toBe('folder');
  });

  it('classifies a directory whose name ends in .jpg as folder, not image', () => {
    expect(classifyByName('album.jpg', true)).toBe('folder');
    expect(classifyByName('export.png', true)).toBe('folder');
  });

  it('classifies an image file as image, case-insensitively', () => {
    expect(classifyByName('photo.jpg', false)).toBe('image');
    expect(classifyByName('photo.JPG', false)).toBe('image');
    expect(classifyByName('image.PNG', false)).toBe('image');
    expect(classifyByName('picture.webp', false)).toBe('image');
  });

  it('classifies a non-image file as file', () => {
    expect(classifyByName('notes.txt', false)).toBe('file');
    expect(classifyByName('document.pdf', false)).toBe('file');
    expect(classifyByName('archive.zip', false)).toBe('file');
  });

  it('classifies a .heic file as file, because the player cannot render it', () => {
    expect(classifyByName('photo.heic', false)).toBe('file');
  });

  it('classifies an extensionless file as file', () => {
    expect(classifyByName('README', false)).toBe('file');
    expect(classifyByName('Makefile', false)).toBe('file');
  });

  it('classifies a dotfile as file', () => {
    expect(classifyByName('.gitignore', false)).toBe('file');
    expect(classifyByName('.env', false)).toBe('file');
  });

  it('returns only values from the EntryType union for a mixed fixture list', () => {
    const fixtures = [
      ['MyFolder', true],
      ['photo.jpg', false],
      ['notes.txt', false],
      ['album.jpg', true],
      ['.hidden.jpg', false],
      ['README', false],
    ] as const;

    const results = new Set(fixtures.map(([name, isDir]) => classifyByName(name, isDir)));
    expect(results).toEqual(new Set(['folder', 'image', 'file']));
  });
});

describe('mimeTypeForName', () => {
  it('returns image/jpeg for a .JFIF name', () => {
    expect(mimeTypeForName('scan.JFIF')).toBe('image/jpeg');
  });

  it('returns a MIME type for every extension in IMAGE_EXTENSIONS', () => {
    for (const ext of IMAGE_EXTENSIONS) {
      const basename = `file${ext}`;
      const mime = mimeTypeForName(basename);
      expect(mime).not.toBeNull();
      expect(typeof mime).toBe('string');
      expect(mime).toMatch(/^image\//);
    }
  });

  it('returns null for a non-image name', () => {
    expect(mimeTypeForName('notes.txt')).toBeNull();
    expect(mimeTypeForName('archive.zip')).toBeNull();
    expect(mimeTypeForName('document.pdf')).toBeNull();
  });

  it('returns null for a name whose extension collides with an Object prototype member (x.constructor, x.__proto__)', () => {
    expect(mimeTypeForName('x.constructor')).toBeNull();
    expect(mimeTypeForName('x.__proto__')).toBeNull();
    expect(mimeTypeForName('file.hasOwnProperty')).toBeNull();
    expect(mimeTypeForName('data.toString')).toBeNull();
  });
});
