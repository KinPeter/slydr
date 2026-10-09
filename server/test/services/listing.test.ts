import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  listDirectory,
  isHiddenName,
  compareNames,
  compareEntries,
  WINDOWS_HIDDEN_NAMES,
} from '../../src/services/listing.js';
import { setJailRoot, resetJailRootForTests } from '../../src/security/jail.js';
import { makeTempBase, removeTree, trySymlink } from '../helpers/fs.js';
import { createTestLogger } from '../helpers/logger.js';
import { mapPool, STAT_CONCURRENCY } from '../../src/services/concurrency.js';

describe('isHiddenName', () => {
  describe('leading dot (all platforms)', () => {
    it('hides entries starting with .', () => {
      const platforms: NodeJS.Platform[] = ['win32', 'darwin', 'linux'];
      for (const platform of platforms) {
        expect(isHiddenName('.config', platform)).toBe(true);
        expect(isHiddenName('.DS_Store', platform)).toBe(true);
        expect(isHiddenName('.a', platform)).toBe(true);
      }
    });

    it('does not hide ordinary non-dot names', () => {
      const platforms: NodeJS.Platform[] = ['win32', 'darwin', 'linux'];
      for (const platform of platforms) {
        expect(isHiddenName('Pictures', platform)).toBe(false);
        expect(isHiddenName('notes.txt', platform)).toBe(false);
      }
    });
  });

  describe('Windows-specific name list', () => {
    it('every exact Windows name matches case-insensitively', () => {
      const exact = WINDOWS_HIDDEN_NAMES.filter((n) => !n.endsWith('*'));
      for (const name of exact) {
        expect(isHiddenName(name, 'win32')).toBe(true);
        expect(isHiddenName(name.toUpperCase(), 'win32')).toBe(true);
        expect(isHiddenName(name.toLowerCase(), 'win32')).toBe(true);
      }
    });

    it('ntuser.* prefix matches', () => {
      expect(isHiddenName('ntuser.ini', 'win32')).toBe(true);
      expect(isHiddenName('ntuser.dat', 'win32')).toBe(true);
      expect(isHiddenName('NTUSER.POL', 'win32')).toBe(true);
      expect(isHiddenName('nTuSeR.whatever', 'win32')).toBe(true);
      // The pattern is "ntuser." so bare "ntuser" should not match
      expect(isHiddenName('ntuser', 'win32')).toBe(false);
    });

    it('NTUSER.DAT* prefix matches', () => {
      expect(isHiddenName('NTUSER.DAT', 'win32')).toBe(true);
      expect(isHiddenName('NTUSER.DAT.LOG1', 'win32')).toBe(true);
      expect(isHiddenName('NTUSER.DAT{016cd0cd-0000-0000-0000-000000000000}.TM.blf', 'win32')).toBe(
        true,
      );
    });

    it('prefix patterns do not over-match', () => {
      expect(isHiddenName('ntuserdata.txt', 'win32')).toBe(false);
      expect(isHiddenName('my-ntuser.ini', 'win32')).toBe(false);
      expect(isHiddenName('NOTNTUSER.DAT', 'win32')).toBe(false);
    });

    it('Windows list does not apply on darwin or linux', () => {
      const winNames = ['AppData', 'Thumbs.db', 'desktop.ini', '$RECYCLE.BIN'];
      for (const name of winNames) {
        expect(isHiddenName(name, 'darwin')).toBe(false);
        expect(isHiddenName(name, 'linux')).toBe(false);
      }
    });
  });

  describe('WINDOWS_HIDDEN_NAMES contract', () => {
    it('is well-formed: 18 entries, each with no * or exactly one trailing *', () => {
      expect(WINDOWS_HIDDEN_NAMES).toHaveLength(18);

      const expected = [
        'AppData',
        '$RECYCLE.BIN',
        'System Volume Information',
        'desktop.ini',
        'Thumbs.db',
        'ntuser.*',
        'NTUSER.DAT*',
        'IconCache.db',
        'Application Data',
        'Local Settings',
        'My Documents',
        'Recent',
        'SendTo',
        'Start Menu',
        'Templates',
        'Cookies',
        'NetHood',
        'PrintHood',
      ];
      expect(Array.from(WINDOWS_HIDDEN_NAMES)).toEqual(expected);

      // Verify each entry's * placement
      for (const entry of WINDOWS_HIDDEN_NAMES) {
        const starCount = (entry.match(/\*/g) ?? []).length;
        if (starCount > 0) {
          expect(starCount).toBe(1);
          expect(entry.endsWith('*')).toBe(true);
        }
      }
    });
  });
});

describe('compareNames', () => {
  it('orders by numeric collation and breaks ties by code unit', () => {
    const aVsA = compareNames('a.jpg', 'A.jpg');
    expect(aVsA).not.toBe(0);
    expect(compareNames('A.jpg', 'a.jpg')).toBe(-aVsA);
  });

  it('returns 0 for identical names', () => {
    expect(compareNames('x', 'x')).toBe(0);
    expect(compareNames('photo.jpg', 'photo.jpg')).toBe(0);
  });

  it('numeric collation: IMG_2 < IMG_10 < IMG_100', () => {
    expect(compareNames('IMG_1.jpg', 'IMG_2.jpg')).toBeLessThan(0);
    expect(compareNames('IMG_2.jpg', 'IMG_10.jpg')).toBeLessThan(0);
    expect(compareNames('IMG_10.jpg', 'IMG_100.jpg')).toBeLessThan(0);
  });

  it('sorts array of numeric names correctly', () => {
    const names = ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'IMG_100.jpg'];
    const sorted = [...names].sort(compareNames);
    expect(sorted).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg', 'IMG_100.jpg']);
  });

  it('case-insensitive grouping with deterministic tie-break', () => {
    // The input order matters for testing the tie-break.
    // Sort order: a < A < b (code-unit comparison for a vs A: 'a' (97) < 'A' (65) is false, 'a' > 'A')
    const input = ['b.jpg', 'A.jpg', 'a.jpg'];
    const sorted = [...input].sort(compareNames);
    // After collation, a.jpg and A.jpg are equal, but code-unit comparison breaks ties:
    // 'A' (65) < 'a' (97), so A.jpg comes before a.jpg
    expect(sorted).toEqual(['A.jpg', 'a.jpg', 'b.jpg']);
  });
});

describe('compareEntries', () => {
  it('folders sort before images and other files', () => {
    const folder = {
      name: 'z_folder',
      path: '',
      type: 'folder' as const,
      hidden: false,
      size: null,
      mtimeMs: 0,
    };
    const image = {
      name: 'a_image.jpg',
      path: '',
      type: 'image' as const,
      hidden: false,
      size: 100,
      mtimeMs: 0,
    };
    const file = {
      name: 'b_file.txt',
      path: '',
      type: 'file' as const,
      hidden: false,
      size: 100,
      mtimeMs: 0,
    };

    // Folder before image
    expect(compareEntries(folder, image)).toBeLessThan(0);
    expect(compareEntries(image, folder)).toBeGreaterThan(0);

    // Folder before file
    expect(compareEntries(folder, file)).toBeLessThan(0);
    expect(compareEntries(file, folder)).toBeGreaterThan(0);

    // Image and file sort by name only
    expect(compareEntries(image, file)).toBeLessThan(0);
    expect(compareEntries(file, image)).toBeGreaterThan(0);
  });

  it('images and files sort together by name only', () => {
    const file = {
      name: 'b.txt',
      path: '',
      type: 'file' as const,
      hidden: false,
      size: 100,
      mtimeMs: 0,
    };
    const image1 = {
      name: 'a.jpg',
      path: '',
      type: 'image' as const,
      hidden: false,
      size: 100,
      mtimeMs: 0,
    };
    const image2 = {
      name: 'c.png',
      path: '',
      type: 'image' as const,
      hidden: false,
      size: 100,
      mtimeMs: 0,
    };

    expect(compareEntries(image1, file)).toBeLessThan(0); // a < b
    expect(compareEntries(file, image2)).toBeLessThan(0); // b < c
  });
});

describe('listDirectory', () => {
  let tempBase: string;

  beforeAll(async () => {
    tempBase = await makeTempBase('slydr-listing-');
    setJailRoot(tempBase);
  });

  afterAll(async () => {
    resetJailRootForTests();
    await removeTree(tempBase);
  });

  describe('basic listing structure', () => {
    let fixtureDir: string;

    beforeAll(async () => {
      fixtureDir = path.join(tempBase, 'fixture-basic');
      await fs.mkdir(fixtureDir);

      // Create fixture
      await fs.mkdir(path.join(fixtureDir, 'Pictures'));
      await fs.mkdir(path.join(fixtureDir, 'Archive'));
      await fs.mkdir(path.join(fixtureDir, '.hidden-folder'));
      if (process.platform === 'win32') {
        await fs.mkdir(path.join(fixtureDir, 'AppData'));
      }

      await fs.writeFile(path.join(fixtureDir, 'IMG_2.jpg'), '');
      await fs.writeFile(path.join(fixtureDir, 'IMG_10.jpg'), '');
      await fs.writeFile(path.join(fixtureDir, 'IMG_1.JPEG'), '');
      await fs.writeFile(path.join(fixtureDir, 'photo.svg'), '');
      await fs.writeFile(path.join(fixtureDir, 'notes.txt'), '');
      await fs.writeFile(path.join(fixtureDir, 'archive.zip'), '');
      await fs.writeFile(path.join(fixtureDir, '.dotfile'), '');
      if (process.platform === 'win32') {
        await fs.writeFile(path.join(fixtureDir, 'Thumbs.db'), '');
      }

      // Symlinks
      const linkInside = path.join(fixtureDir, 'link-inside');
      const linkImg = path.join(fixtureDir, 'link-img');
      const linkImgJpg = path.join(fixtureDir, 'link-img.jpg');
      const linkDataJpg = path.join(fixtureDir, 'link-data.jpg');

      await trySymlink(path.join(fixtureDir, 'Pictures'), linkInside, 'dir');
      await trySymlink(path.join(fixtureDir, 'IMG_2.jpg'), linkImg, 'file');
      await trySymlink(path.join(fixtureDir, 'IMG_2.jpg'), linkImgJpg, 'file');
      await trySymlink(path.join(fixtureDir, 'notes.txt'), linkDataJpg, 'file');

      // Outside link (need an outside directory)
      const outsideDir = path.join(tempBase, 'outside');
      await fs.mkdir(outsideDir);
      const linkOutside = path.join(fixtureDir, 'link-outside');
      await trySymlink(outsideDir, linkOutside, 'dir');

      // Broken link
      await trySymlink('./nope', path.join(fixtureDir, 'link-broken'), 'file');
    });

    afterAll(async () => {
      await removeTree(fixtureDir);
    });

    it('returns folders first, then images and files by name', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      const names = result.entries.map((e) => e.name);

      // Folders first
      const folders = names.filter((n, i) => result.entries[i]?.type === 'folder');
      const nonFolders = names.filter((n, i) => result.entries[i]?.type !== 'folder');

      // Archive, Pictures, link-inside should be present as folders
      expect(folders).toContain('Archive');
      expect(folders).toContain('Pictures');

      // Verify folders appear before non-folders
      if (folders.length > 0 && nonFolders.length > 0) {
        const lastFolder = folders[folders.length - 1];
        const firstNonFolder = nonFolders[0];
        if (lastFolder && firstNonFolder) {
          const lastFolderIndex = names.lastIndexOf(lastFolder);
          const firstNonFolderIndex = names.indexOf(firstNonFolder);
          expect(lastFolderIndex).toBeLessThan(firstNonFolderIndex);
        }
      }
    });

    it('classifies images by extension, case-insensitively', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      const entry = (name: string) => result.entries.find((e) => e.name === name);

      expect(entry('IMG_1.JPEG')?.type).toBe('image');
      expect(entry('photo.svg')?.type).toBe('image');
      expect(entry('notes.txt')?.type).toBe('file');
      expect(entry('archive.zip')?.type).toBe('file');
    });

    it('folders have size null and a numeric mtimeMs', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      for (const entry of result.entries) {
        if (entry.type === 'folder') {
          expect(entry.size).toBeNull();
          expect(typeof entry.mtimeMs).toBe('number');
        }
      }
    });

    it('files have a numeric size and mtimeMs', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      for (const entry of result.entries) {
        if (entry.type === 'file' || entry.type === 'image') {
          expect(typeof entry.size).toBe('number');
          expect(typeof entry.mtimeMs).toBe('number');
        }
      }
    });

    it('wire paths are POSIX and relative to jail root', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: 'sub',
      });

      for (const entry of result.entries) {
        // Check for POSIX separators only
        expect(entry.path).not.toContain('\\');
        // Verify it starts with wireDir
        expect(entry.path).toMatch(/^sub\//);
      }
    });

    it('symlink to a directory inside root is classified as folder', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      const linkInside = result.entries.find((e) => e.name === 'link-inside');
      // Skip if symlinks are not supported on this platform
      if (linkInside === undefined) {
        return;
      }
      expect(linkInside.type).toBe('folder');
      expect(linkInside.size).toBeNull();
    });

    it('a folder symlink inside the jail is followed', async () => {
      // Navigate into the symlinked folder and verify we get the target's entries
      const linkInsidePath = path.join(fixtureDir, 'link-inside');

      // First, verify that link-inside actually exists and is a folder symlink
      const parentResult = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });
      const linkInside = parentResult.entries.find((e) => e.name === 'link-inside');
      if (!linkInside || linkInside.type !== 'folder') {
        // Skip if symlinks are not supported
        return;
      }

      // Now list the symlinked folder directly
      const result = await listDirectory(linkInsidePath, {
        showHidden: false,
        wireDir: 'link-inside',
      });

      // Should return the entries from Pictures (the target of link-inside)
      // We didn't put anything in Pictures in this fixture, so it should be empty or contain only its own contents
      // But we can verify that the paths are correctly prefixed with 'link-inside'
      for (const entry of result.entries) {
        expect(entry.path).toMatch(/^link-inside\//);
      }
    });

    it('image-ness comes from the symlink own name (FR-2.1)', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      // Skip if symlinks are not supported
      if (
        !result.entries.find((e) => e.name === 'link-img') &&
        !result.entries.find((e) => e.name === 'link-img.jpg') &&
        !result.entries.find((e) => e.name === 'link-data.jpg')
      ) {
        return;
      }

      // link-img has no image extension, so it's a file even though target is an image
      const linkImg = result.entries.find((e) => e.name === 'link-img');
      if (linkImg) {
        expect(linkImg.type).toBe('file');
      }

      // link-img.jpg has .jpg extension, so it's an image
      const linkImgJpg = result.entries.find((e) => e.name === 'link-img.jpg');
      if (linkImgJpg) {
        expect(linkImgJpg.type).toBe('image');
      }

      // link-data.jpg has .jpg extension, but target is notes.txt (not an image by extension)
      // The image-ness is determined by the link's own name
      const linkDataJpg = result.entries.find((e) => e.name === 'link-data.jpg');
      if (linkDataJpg) {
        expect(linkDataJpg.type).toBe('image');
      }
    });

    it('symlink outside root is omitted', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      const linkOutside = result.entries.find((e) => e.name === 'link-outside');
      expect(linkOutside).toBeUndefined();
    });

    it('broken symlink is omitted', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      const linkBroken = result.entries.find((e) => e.name === 'link-broken');
      expect(linkBroken).toBeUndefined();
    });

    it('special file (FIFO/socket) is omitted (simulated)', async () => {
      // Spy on readdir to return a fake FIFO dirent
      const { logger, events } = createTestLogger();

      const fakeDir = path.join(fixtureDir, 'fakedir-for-special-test');
      await fs.mkdir(fakeDir);

      try {
        const originalReaddir = fs.readdir.bind(fs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(fs, 'readdir').mockImplementation(async (dir: unknown): Promise<any> => {
          const dirStr =
            typeof dir === 'string'
              ? dir
              : dir instanceof Buffer
                ? dir.toString()
                : (dir as URL).pathname;
          if (dirStr === fakeDir) {
            // Return real dirents plus a fake FIFO
            const real = (await originalReaddir(dirStr, { withFileTypes: true })) as unknown[];
            const fakeFifo = {
              name: 'fake-fifo',
              isFile: () => false,
              isDirectory: () => false,
              isSymbolicLink: () => false,
              isFIFO: () => true,
              isSocket: () => false,
              isBlockDevice: () => false,
              isCharacterDevice: () => false,
            };
            return [...real, fakeFifo];
          }
          return originalReaddir(dirStr, { withFileTypes: true });
        });

        const result = await listDirectory(fakeDir, {
          showHidden: false,
          wireDir: '',
          logger,
        });

        const fakeFifo = result.entries.find((e) => e.name === 'fake-fifo');
        expect(fakeFifo).toBeUndefined();

        // Check that it was logged
        const skipEvent = events.find(
          (e) => e.event === 'listing.entry-skipped' && e.fields.reason === 'special-file',
        );
        expect(skipEvent).toBeDefined();
      } finally {
        vi.restoreAllMocks();
        await removeTree(fakeDir);
      }
    });

    it('un-addressable name is omitted', async () => {
      const { logger } = createTestLogger();

      const fakeDir = path.join(fixtureDir, 'fakedir-for-unaddressable-test');
      await fs.mkdir(fakeDir);

      try {
        const originalReaddir = fs.readdir.bind(fs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(fs, 'readdir').mockImplementation(async (dir: unknown): Promise<any> => {
          const dirStr =
            typeof dir === 'string'
              ? dir
              : dir instanceof Buffer
                ? dir.toString()
                : (dir as URL).pathname;
          if (dirStr === fakeDir) {
            const real = (await originalReaddir(dirStr, { withFileTypes: true })) as unknown[];
            const fakeEntry = {
              name: 'C:backup.jpg',
              isFile: () => true,
              isDirectory: () => false,
              isSymbolicLink: () => false,
              isFIFO: () => false,
              isSocket: () => false,
              isBlockDevice: () => false,
              isCharacterDevice: () => false,
            };
            return [...real, fakeEntry];
          }
          return originalReaddir(dirStr, { withFileTypes: true });
        });

        const result = await listDirectory(fakeDir, {
          showHidden: false,
          wireDir: '',
          logger,
        });

        const fakeEntry = result.entries.find((e) => e.name === 'C:backup.jpg');
        expect(fakeEntry).toBeUndefined();
      } finally {
        vi.restoreAllMocks();
        await removeTree(fakeDir);
      }
    });

    it.runIf(process.platform === 'win32')(
      'a Windows junction pointing outside the root is omitted',
      async (ctx) => {
        // Create a directory that is truly outside the jail root
        // We use os.tmpdir() directly (not under tempBase) to ensure it's outside the jail
        const os = await import('node:os');
        const realTmpDir = os.tmpdir();
        const outsideDir = path.join(realTmpDir, `slydr-outside-${Date.now()}-${Math.random()}`);
        const junctionLink = path.join(fixtureDir, 'junction-outside');

        try {
          // Create the target directory outside of tempBase (which is the jail root)
          try {
            await fs.mkdir(outsideDir, { recursive: true });
          } catch {
            // Already exists
          }

          const created = await trySymlink(outsideDir, junctionLink, 'junction');
          if (!created) {
            // Skip if junctions are not supported (requires elevation or developer mode)
            ctx.skip();
            return;
          }

          const result = await listDirectory(fixtureDir, {
            showHidden: false,
            wireDir: '',
          });

          const junction = result.entries.find((e) => e.name === 'junction-outside');
          expect(junction).toBeUndefined();
        } finally {
          try {
            await fs.rm(junctionLink, { force: true });
          } catch {
            // Already removed
          }
          try {
            await fs.rm(outsideDir, { force: true });
          } catch {
            // Already removed
          }
        }
      },
    );

    it('hidden entries are excluded by default', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      const hasHidden = result.entries.some((e) => e.hidden);
      expect(hasHidden).toBe(false);

      const dotfile = result.entries.find((e) => e.name === '.dotfile');
      expect(dotfile).toBeUndefined();

      const hiddenFolder = result.entries.find((e) => e.name === '.hidden-folder');
      expect(hiddenFolder).toBeUndefined();
    });

    it('hidden entries are included when requested and still flagged', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: true,
        wireDir: '',
      });

      const dotfile = result.entries.find((e) => e.name === '.dotfile');
      expect(dotfile).toBeDefined();
      expect(dotfile?.hidden).toBe(true);

      const hiddenFolder = result.entries.find((e) => e.name === '.hidden-folder');
      expect(hiddenFolder).toBeDefined();
      expect(hiddenFolder?.hidden).toBe(true);
    });

    it.runIf(process.platform === 'win32')('the Windows name list filters on win32', async () => {
      const result = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      // On win32, AppData and Thumbs.db should be absent when showHidden is false
      const appData = result.entries.find((e) => e.name === 'AppData');
      expect(appData).toBeUndefined();

      const thumbsDb = result.entries.find((e) => e.name === 'Thumbs.db');
      expect(thumbsDb).toBeUndefined();
    });

    it.skipIf(process.platform === 'win32')(
      'the Windows name list does not filter on POSIX',
      async () => {
        // This test verifies that on POSIX platforms, AppData and Thumbs.db would not be filtered
        // even though the fixture only creates them on win32.
        // Test through isHiddenName directly to confirm the rule does not apply on non-win32.
        expect(isHiddenName('AppData', 'darwin')).toBe(false);
        expect(isHiddenName('Thumbs.db', 'darwin')).toBe(false);
        expect(isHiddenName('AppData', 'linux')).toBe(false);
        expect(isHiddenName('Thumbs.db', 'linux')).toBe(false);
      },
    );

    it('counts tallies the post-filter entries', async () => {
      const resultHidden = await listDirectory(fixtureDir, {
        showHidden: true,
        wireDir: '',
      });

      const resultNotHidden = await listDirectory(fixtureDir, {
        showHidden: false,
        wireDir: '',
      });

      // With showHidden false, counts should exclude hidden entries
      expect(
        resultNotHidden.counts.folders +
          resultNotHidden.counts.images +
          resultNotHidden.counts.files,
      ).toBe(resultNotHidden.entries.length);

      // With showHidden true, counts should be higher
      expect(
        resultHidden.counts.folders + resultHidden.counts.images + resultHidden.counts.files,
      ).toBe(resultHidden.entries.length);
      expect(
        resultHidden.counts.folders + resultHidden.counts.images + resultHidden.counts.files,
      ).toBeGreaterThan(
        resultNotHidden.counts.folders +
          resultNotHidden.counts.images +
          resultNotHidden.counts.files,
      );
    });

    it('entry whose stat fails is omitted and listing still succeeds', async () => {
      const { logger, events } = createTestLogger();

      const testDir = path.join(fixtureDir, 'stat-fail-test');
      await fs.mkdir(testDir);

      try {
        await fs.writeFile(path.join(testDir, 'file1.txt'), 'content');
        await fs.writeFile(path.join(testDir, 'file2.txt'), 'content');

        const originalStat = fs.stat.bind(fs);
        vi.spyOn(fs, 'stat').mockImplementation(async (p: string | Buffer | URL) => {
          const pStr = typeof p === 'string' ? p : p instanceof URL ? p.pathname : p.toString();
          if (pStr.includes('file1.txt')) {
            const err = new Error('EACCES: permission denied');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (err as any).code = 'EACCES';
            throw err;
          }
          return originalStat(pStr);
        });

        const result = await listDirectory(testDir, {
          showHidden: false,
          wireDir: '',
          logger,
        });

        // file1.txt should be absent
        const file1 = result.entries.find((e) => e.name === 'file1.txt');
        expect(file1).toBeUndefined();

        // file2.txt should be present
        const file2 = result.entries.find((e) => e.name === 'file2.txt');
        expect(file2).toBeDefined();

        // Check logging
        const skipEvent = events.find(
          (e) => e.event === 'listing.entry-skipped' && e.fields.reason === 'stat-failed',
        );
        expect(skipEvent).toBeDefined();
        expect(skipEvent?.fields.errCode).toBe('EACCES');
      } finally {
        vi.restoreAllMocks();
        await removeTree(testDir);
      }
    });

    it('empty directory returns no entries, zero counts and truncated false', async () => {
      const emptyDir = path.join(fixtureDir, 'empty');
      await fs.mkdir(emptyDir);

      try {
        const result = await listDirectory(emptyDir, {
          showHidden: false,
          wireDir: '',
        });

        expect(result.entries).toHaveLength(0);
        expect(result.counts).toEqual({ folders: 0, images: 0, files: 0 });
        expect(result.truncated).toBe(false);
      } finally {
        await removeTree(emptyDir);
      }
    });
  });

  describe('truncation', () => {
    let truncDir: string;

    beforeAll(async () => {
      truncDir = path.join(tempBase, 'fixture-truncation');
      await fs.mkdir(truncDir);
    });

    afterAll(async () => {
      await removeTree(truncDir);
    });

    it('10000 entries are not truncated', async () => {
      const dir = path.join(truncDir, 'not-truncated');
      await fs.mkdir(dir);

      try {
        // Create exactly 10000 files
        const MAX_ENTRIES = 10000;
        const fileCount = MAX_ENTRIES;

        await mapPool(
          Array.from({ length: fileCount }, (_, i) => {
            const name = `f${String(i + 1).padStart(5, '0')}.txt`;
            return { dir, name };
          }),
          STAT_CONCURRENCY,
          ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
        );

        const result = await listDirectory(dir, {
          showHidden: false,
          wireDir: '',
        });

        expect(result.entries).toHaveLength(fileCount);
        expect(result.truncated).toBe(false);
      } finally {
        await removeTree(dir);
      }
    }, 60000);

    it('10001 entries are truncated to 10000 with truncated true', async () => {
      const dir = path.join(truncDir, 'truncated');
      await fs.mkdir(dir);

      try {
        const MAX_ENTRIES = 10000;
        const fileCount = MAX_ENTRIES + 1;

        await mapPool(
          Array.from({ length: fileCount }, (_, i) => {
            const name = `f${String(i + 1).padStart(5, '0')}.txt`;
            return { dir, name };
          }),
          STAT_CONCURRENCY,
          ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
        );

        const result = await listDirectory(dir, {
          showHidden: false,
          wireDir: '',
        });

        expect(result.entries).toHaveLength(MAX_ENTRIES);
        expect(result.truncated).toBe(true);
      } finally {
        await removeTree(dir);
      }
    }, 60000);

    it('truncation keeps the sorted prefix', async () => {
      const dir = path.join(truncDir, 'sorted-truncation');
      await fs.mkdir(dir);

      try {
        const MAX_ENTRIES = 10000;
        const fileCount = MAX_ENTRIES + 1;

        await mapPool(
          Array.from({ length: fileCount }, (_, i) => {
            const name = `f${String(i + 1).padStart(5, '0')}.txt`;
            return { dir, name };
          }),
          STAT_CONCURRENCY,
          ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
        );

        const result = await listDirectory(dir, {
          showHidden: false,
          wireDir: '',
        });

        // Last returned entry should be f10000.txt
        expect(result.entries[MAX_ENTRIES - 1]?.name).toBe('f10000.txt');

        // f10001.txt should not be present
        const hasF10001 = result.entries.some((e) => e.name === 'f10001.txt');
        expect(hasF10001).toBe(false);
      } finally {
        await removeTree(dir);
      }
    }, 60000);

    it('counts reflect full post-filter set, not truncated slice', async () => {
      const dir = path.join(truncDir, 'counts-full');
      await fs.mkdir(dir);

      try {
        const MAX_ENTRIES = 10000;
        const fileCount = MAX_ENTRIES + 1;

        await mapPool(
          Array.from({ length: fileCount }, (_, i) => {
            const name = `f${String(i + 1).padStart(5, '0')}.txt`;
            return { dir, name };
          }),
          STAT_CONCURRENCY,
          ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
        );

        const result = await listDirectory(dir, {
          showHidden: false,
          wireDir: '',
        });

        // Counts should reflect all 10001 files, not just the 10000 returned
        expect(result.counts.files).toBe(fileCount);
        expect(result.counts.files).toBeGreaterThan(result.entries.length);
      } finally {
        await removeTree(dir);
      }
    }, 60000);

    it('truncation evaluated after hidden filtering', async () => {
      const dir = path.join(truncDir, 'hidden-truncation');
      await fs.mkdir(dir);

      try {
        // Create 10500 entries: 10000 normal, 500 hidden
        // After filtering hidden, we have exactly 10000 visible (not truncated)
        const normalCount = 10000;
        const hiddenCount = 500;

        await mapPool(
          Array.from({ length: normalCount }, (_, i) => {
            const name = `f${String(i + 1).padStart(5, '0')}.txt`;
            return { dir, name };
          }),
          STAT_CONCURRENCY,
          ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
        );

        await mapPool(
          Array.from({ length: hiddenCount }, (_, i) => {
            const name = `.hidden${String(i + 1).padStart(5, '0')}.txt`;
            return { dir, name };
          }),
          STAT_CONCURRENCY,
          ({ dir: d, name }) => fs.writeFile(path.join(d, name), ''),
        );

        const result = await listDirectory(dir, {
          showHidden: false,
          wireDir: '',
        });

        // Total: 10500 entries (10000 normal + 500 hidden)
        // With showHidden=false: visible=10000, truncated=false
        expect(result.truncated).toBe(false);
        const totalCounts = result.counts.files + result.counts.images + result.counts.folders;
        expect(totalCounts).toBe(normalCount); // 10000
      } finally {
        await removeTree(dir);
      }
    }, 120000);
  });

  describe('error handling', () => {
    let errorDir: string;

    beforeAll(async () => {
      errorDir = path.join(tempBase, 'fixture-errors');
      await fs.mkdir(errorDir);
    });

    afterAll(async () => {
      await removeTree(errorDir);
    });

    it('unreadable directory throws ACCESS_DENIED', async () => {
      const testDir = path.join(errorDir, 'unreadable');
      await fs.mkdir(testDir);

      try {
        // On POSIX, we can chmod the directory to 0o000 to trigger EACCES
        // On Windows, we'd need to remove read permissions via ACLs, which is complex
        // Skip on Windows and when running as root
        if (process.platform !== 'win32' && process.getuid?.() !== 0) {
          await fs.chmod(testDir, 0o000);

          try {
            const promise = listDirectory(testDir, {
              showHidden: false,
              wireDir: '',
            });

            await expect(promise).rejects.toThrow();
            const err = await promise.catch((e) => e);
            expect(err.code).toBe('ACCESS_DENIED');
            expect(err.status).toBe(403);
            // Verify no absolute path or errno in message
            expect(err.message).not.toContain(testDir);
            expect(err.message).not.toContain('EACCES');
          } finally {
            // Restore permissions so cleanup can remove the dir
            await fs.chmod(testDir, 0o755);
          }
        }
      } finally {
        await removeTree(testDir);
      }
    });

    it('missing directory throws NOT_FOUND', async () => {
      const missingDir = path.join(errorDir, 'missing-dir-12345');

      const promise = listDirectory(missingDir, {
        showHidden: false,
        wireDir: '',
      });

      await expect(promise).rejects.toThrow();
      const err = await promise.catch((e) => e);
      expect(err.code).toBe('NOT_FOUND');
    });
  });
});
