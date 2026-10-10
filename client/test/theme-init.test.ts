import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../src/state/theme';

// Vitest rewrites `import.meta.url`, so resolve fixture paths from the
// process working directory instead. When run from the repo root the files
// live under `client/`; when run from inside `client/` they are siblings.
async function readClientFile(...segments: string[]): Promise<string> {
  const candidates = [join(process.cwd(), 'client', ...segments), join(process.cwd(), ...segments)];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

let cachedSource: string | null = null;

async function themeInitSource(): Promise<string> {
  if (cachedSource === null) cachedSource = await readClientFile('public', 'theme-init.js');
  return cachedSource;
}

/** Executes the pre-paint script the way the parser-blocking tag does: before paint. */
function runThemeInit(source: string): void {
  new Function(source)();
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('theme-init.js (anti-FOUC, spec §6.3)', () => {
  it('sets data-theme="dark" when slydr.theme is "dark"', async () => {
    expect(THEME_STORAGE_KEY).toBe('slydr.theme');
    window.localStorage.setItem('slydr.theme', 'dark');
    runThemeInit(await themeInitSource());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme="light" when slydr.theme is "light"', async () => {
    window.localStorage.setItem('slydr.theme', 'light');
    runThemeInit(await themeInitSource());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaves data-theme absent when slydr.theme is missing, so CSS follows the OS', async () => {
    runThemeInit(await themeInitSource());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('leaves data-theme absent when slydr.theme holds an invalid value', async () => {
    window.localStorage.setItem('slydr.theme', 'midnight');
    runThemeInit(await themeInitSource());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('does not throw when localStorage access throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = await themeInitSource();
    expect(() => runThemeInit(source)).not.toThrow();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('removes a pre-existing data-theme attribute when no override is stored', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    runThemeInit(await themeInitSource());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('index.html script wiring', () => {
  it('loads /theme-init.js with a classic script tag in <head>', async () => {
    const html = await readClientFile('index.html');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('<script src="/theme-init.js"></script>');
  });

  it('does not mark the theme script defer, async or type="module"', async () => {
    const html = await readClientFile('index.html');
    const match = html.match(/<script[^>]*src="\/theme-init\.js"[^>]*>/);
    expect(match).not.toBeNull();
    const tag = match?.[0] ?? '';
    expect(tag).not.toMatch(/\bdefer\b/);
    expect(tag).not.toMatch(/\basync\b/);
    expect(tag).not.toMatch(/\btype\s*=/);
  });

  it('places the theme script after the color-scheme meta tag', async () => {
    const html = await readClientFile('index.html');
    expect(html.indexOf('<script src="/theme-init.js"></script>')).toBeGreaterThan(
      html.indexOf('name="color-scheme"'),
    );
  });

  it('contains no inline <script> body, which the §3.4 CSP would block', async () => {
    const html = await readClientFile('index.html');
    const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag[1]).toMatch(/\bsrc\s*=/);
      expect(tag[2]?.trim()).toBe('');
    }
  });
});
