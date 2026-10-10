import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner decision: every boolean option is a checkbox, never a switch (T022 §4.5).
// This test scans the library source so a `role="switch"` can never creep back in.

async function collectSourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectSourceFiles(full)));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

async function findComponentsDir(): Promise<string> {
  const candidates = [
    join(process.cwd(), 'client', 'src', 'components'),
    join(process.cwd(), 'src', 'components'),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('components directory not found');
}

describe('no switch in the component library', () => {
  it('no file uses role="switch" and there is no Toggle component', async () => {
    const dir = await findComponentsDir();
    const files = await collectSourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);

    const switchHits: string[] = [];
    for (const file of files) {
      const raw = await readFile(file, 'utf8');
      // Doc comments may discuss the forbidden role; only real code counts.
      const text = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => {
          const idx = line.indexOf('//');
          return idx < 0 ? line : line.slice(0, idx);
        })
        .join('\n');
      if (/role\s*=\s*['"]switch['"]/.test(text) || /role:\s*['"]switch['"]/.test(text)) {
        switchHits.push(file);
      }
    }
    expect(switchHits).toEqual([]);

    const toggleHits = files.filter((file) => basename(file).startsWith('Toggle'));
    expect(toggleHits).toEqual([]);
  });
});
