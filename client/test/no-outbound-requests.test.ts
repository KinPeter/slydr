import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Preferred anchor per T025 §4.8: resolve relative to this file, so the scan
// behaves identically on Windows, macOS and Linux (separators normalised
// with path.sep when comparing). Vitest rewrites `import.meta.url` (see
// test/theme-init.test.ts), so when the anchor is unusable fall back to the
// process working directory: the repo root under `npm test`, the workspace
// directory when vitest runs inside `client/`.
function anchoredEntry(relative: string): string | null {
  try {
    return fileURLToPath(new URL(relative, import.meta.url));
  } catch {
    return null;
  }
}

async function resolveClientEntry(...segments: string[]): Promise<string> {
  const anchored =
    segments.length === 1
      ? anchoredEntry(`../${segments[0] as string}`)
      : anchoredEntry(`../${segments.join('/')}`);
  if (anchored !== null) return anchored;
  const candidates = [
    path.join(process.cwd(), 'client', ...segments),
    path.join(process.cwd(), ...segments),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`Cannot locate client entry: ${segments.join('/')}`);
}

async function srcDir(): Promise<string> {
  return resolveClientEntry('src');
}

async function indexHtml(): Promise<string> {
  return resolveClientEntry('index.html');
}

const CLIENT_API_FILE = ['api', 'client.ts'].join(path.sep);
// The one allowed http(s) literal anywhere: the SVG namespace.
const SVG_NAMESPACE = 'http://www.w3.org/';

async function collectSourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectSourceFiles(full)));
    } else if (
      entry.isFile() &&
      (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.css')) &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.test.tsx')
    ) {
      found.push(full);
    }
  }
  return found;
}

function stripAllowedNamespace(text: string): string {
  return text.split(SVG_NAMESPACE).join('');
}

describe('NFR-9 no outbound requests', () => {
  it('contains no http(s):// literal in client source, apart from the SVG namespace', async () => {
    const dir = await srcDir();
    const files = await collectSourceFiles(dir);
    const offenders: string[] = [];
    for (const file of files) {
      const text = stripAllowedNamespace(await fs.readFile(file, 'utf8'));
      if (/https?:\/\//.test(text)) offenders.push(path.relative(dir, file));
    }
    expect(offenders).toEqual([]);
  });

  it('contains no external script, stylesheet or font reference in index.html', async () => {
    const html = stripAllowedNamespace(await fs.readFile(await indexHtml(), 'utf8'));
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/(src|href)\s*=\s*["']\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?\/\//i);
  });

  it('uses fetch( only inside client/src/api/client.ts (the thumbnail queue must go through fetchThumbnailBlob)', async () => {
    const dir = await srcDir();
    const files = await collectSourceFiles(dir);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      const relative = path.relative(dir, file);
      const isApiClient = relative === CLIENT_API_FILE;
      if (!isApiClient && text.includes('fetch(')) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
    const apiClient = files.find((file) => path.relative(dir, file) === CLIENT_API_FILE);
    expect(apiClient).toBeDefined();
  });

  it('does not use XMLHttpRequest, WebSocket, EventSource or sendBeacon', async () => {
    const dir = await srcDir();
    const files = await collectSourceFiles(dir);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      if (
        text.includes('XMLHttpRequest') ||
        text.includes('WebSocket') ||
        text.includes('EventSource') ||
        text.includes('sendBeacon')
      ) {
        offenders.push(path.relative(dir, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds at least one source file (guards against a broken path making the scan vacuous)', async () => {
    const files = await collectSourceFiles(await srcDir());
    expect(files.length).toBeGreaterThan(0);
  });
});
