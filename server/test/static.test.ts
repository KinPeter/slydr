import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { CSP } from '../src/middleware/securityHeaders.js';
import { makeTestConfig } from './helpers/testConfig.js';

describe('production static hosting', () => {
  let clientDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    clientDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slydr-dist-'));
    await fs.mkdir(path.join(clientDir, 'assets'));
    await Promise.all([
      fs.writeFile(path.join(clientDir, 'index.html'), '<!doctype html><div id="root"></div>'),
      fs.writeFile(path.join(clientDir, 'theme-init.js'), '/* init */'),
      fs.writeFile(path.join(clientDir, '.secret'), 'hidden'),
      fs.writeFile(path.join(clientDir, 'assets', 'index-Dk3fA9xZ.js'), 'js'),
      fs.writeFile(path.join(clientDir, 'assets', 'logo.svg'), 'svg'),
    ]);
    app = createApp(makeTestConfig({ clientDir }));
  });

  afterAll(async () => fs.rm(clientDir, { recursive: true, force: true }));

  it('serves HTML with the exact security and cache headers', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets only and handles the favicon', async () => {
    expect(
      (await request(app).get('/assets/index-Dk3fA9xZ.js')).headers['cache-control'],
    ).toContain('immutable');
    expect((await request(app).get('/theme-init.js')).headers['cache-control']).toBe('no-cache');
    expect((await request(app).get('/favicon.ico')).status).toBe(204);
  });

  it('does not expose directories, dotfiles, traversal, or an SPA fallback', async () => {
    expect((await request(app).get('/assets/')).status).toBe(404);
    expect((await request(app).get('/.secret')).status).toBe(404);
    expect((await request(app).get('/some/deep/path')).text).toBe('Not found');
    expect((await request(app).get('/%2e%2e/package.json')).status).toBe(404);
  });

  it('keeps API and global guards ahead of static hosting', async () => {
    expect((await request(app).get('/api/does-not-exist')).body.error.code).toBe('NOT_FOUND');
    expect((await request(app).post('/')).status).toBe(405);
    expect((await request(app).get('/').set('Host', 'evil.example')).status).toBe(403);
  });

  it('supports validators and API-only mode', async () => {
    const first = await request(app).get('/index.html');
    const etag = first.headers.etag;
    expect(etag).toBeDefined();
    expect(
      (
        await request(app)
          .get('/index.html')
          .set('If-None-Match', etag ?? '')
      ).status,
    ).toBe(304);
    expect((await request(createApp(makeTestConfig())).get('/')).status).toBe(404);
  });
});
