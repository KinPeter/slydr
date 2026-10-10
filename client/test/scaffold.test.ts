import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('client scaffold', () => {
  it('index.html declares <meta name="color-scheme" content="light dark">', async () => {
    const html = await readClientFile('index.html');
    expect(html).toContain('<meta name="color-scheme" content="light dark"');
  });

  it('index.html reserves the anti-FOUC theme script placeholder in <head>', async () => {
    const html = await readClientFile('index.html');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('T021');
    expect(head).toMatch(/anti-FOUC/i);
  });

  it('index.html loads /src/main.tsx as a module script', async () => {
    const html = await readClientFile('index.html');
    expect(html).toContain('<script type="module" src="/src/main.tsx">');
  });

  it('the T001 dependencies and the T002 test settings were left intact', async () => {
    const pkg = JSON.parse(await readClientFile('package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@tanstack/react-virtual']).toBeDefined();
    expect(pkg.dependencies?.['lucide-react']).toBeDefined();

    const tsconfig = await readClientFile('tsconfig.json');
    expect(tsconfig).not.toContain('vitest/globals');

    const vitestConfig = await readClientFile('vitest.config.ts');
    expect(vitestConfig).not.toContain('vitest/globals');
    expect(vitestConfig).not.toMatch(/globals\s*:\s*true/);
  });
});
