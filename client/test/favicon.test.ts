import fs from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Same resolution rule as client/test/scaffold.test.ts: Vitest rewrites
// `import.meta.url`, so fixture paths are read from the process working
// directory (repo root → `client/…`, running inside `client/` → `…`).
async function readClientFile(...segments: string[]): Promise<string> {
  const candidates = [join(process.cwd(), 'client', ...segments), join(process.cwd(), ...segments)];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function existsInPublic(name: string): Promise<boolean> {
  for (const candidate of [
    join(process.cwd(), 'client', 'public', name),
    join(process.cwd(), 'public', name),
  ]) {
    try {
      await fs.stat(candidate);
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
}

describe('app icons (client/public favicon assets)', () => {
  it('index.html declares icon and apple-touch-icon links in <head>', async () => {
    const html = await readClientFile('index.html');
    const head = html.slice(0, html.indexOf('</head>'));
    const rels = [...head.matchAll(/<link\b[^>]*>/g)]
      .map((tag) => /rel="([^"]+)"/.exec(tag[0])?.[1])
      .filter(Boolean);
    expect(rels).toContain('icon');
    expect(rels).toContain('apple-touch-icon');
  });

  it('declares the ICO, 16px, 32px and apple-touch icons shipped in client/public', async () => {
    const html = await readClientFile('index.html');
    for (const file of [
      '/favicon.ico',
      '/favicon-16x16.png',
      '/favicon-32x32.png',
      '/apple-touch-icon.png',
    ]) {
      expect(html).toContain(`href="${file}"`);
    }
  });

  it('every icon URL is same-origin, as the §3.4 CSP requires', async () => {
    const html = await readClientFile('index.html');
    const hrefs = [...html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*>/g)]
      .map((m) => m[1])
      .filter((href): href is string => typeof href === 'string');
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith('/')).toBe(true);
      expect(await existsInPublic(href.slice(1))).toBe(true);
    }
  });

  it('does not link a manifest: Slydr is loopback-only, not an installable PWA', async () => {
    const html = await readClientFile('index.html');
    expect(html).not.toMatch(/rel="manifest"/);
  });

  it('keeps the shipped manifest named "Slydr" and pointed at the android-chrome icons', async () => {
    const manifest = JSON.parse(await readClientFile('public', 'site.webmanifest')) as {
      name?: string;
      short_name?: string;
      icons?: Array<{ src?: string }>;
    };
    expect(manifest.name).toBe('Slydr');
    expect(manifest.short_name).toBe('Slydr');
    expect(Array.isArray(manifest.icons)).toBe(true);
    for (const icon of manifest.icons ?? []) {
      expect(icon.src).toMatch(/^\/android-chrome-\d+x\d+\.png$/);
      expect(await existsInPublic(icon.src ?? '')).toBe(true);
    }
  });
});
