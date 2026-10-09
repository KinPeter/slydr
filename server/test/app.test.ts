import express from 'express';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeTestConfig } from './helpers/testConfig.js';
import { securityHeaders, CSP_VALUE } from '../src/middleware/securityHeaders.js';
import { hostCheck } from '../src/middleware/hostCheck.js';
import { methodGuard } from '../src/middleware/methodGuard.js';
import {
  apiNotFoundHandler,
  createErrorEnvelope,
  ApiError,
} from '../src/middleware/errorEnvelope.js';

describe('app integration tests (Supertest)', () => {
  it('GET /api/health returns ok and a version', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
  });

  it('HEAD /api/health returns 200 with an empty body', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).head('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('health response is not cacheable', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).get('/api/health');

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('POST /api/health returns 405 METHOD_NOT_ALLOWED with an Allow header', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).post('/api/health');

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(res.headers['allow']).toBe('GET, HEAD');
  });

  it('PUT /, DELETE /api/fs/list and OPTIONS /api/health all return 405', async () => {
    const app = createApp(makeTestConfig());

    const testCases = [
      { method: 'PUT', path: '/' },
      { method: 'DELETE', path: '/api/fs/list' },
      { method: 'OPTIONS', path: '/api/health' },
    ];

    for (const { method, path } of testCases) {
      const res = await request(app)[method.toLowerCase() as 'put' | 'delete' | 'options'](path);
      expect(res.status).toBe(405);
      expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
      expect(res.headers['allow']).toBe('GET, HEAD');
    }
  });

  it('a non-loopback Host returns 403 FORBIDDEN_HOST', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).get('/api/health').set('Host', 'evil.example');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_HOST');
  });

  it('a non-loopback Host on a non-GET method reports FORBIDDEN_HOST, not METHOD_NOT_ALLOWED', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).post('/api/health').set('Host', 'evil.example');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_HOST');
  });

  it('allowed Host values pass', async () => {
    const app = createApp(makeTestConfig());
    const testHosts = [
      'localhost',
      'localhost:4317',
      '127.0.0.1',
      '127.0.0.1:4317',
      '[::1]',
      '[::1]:4317',
    ];

    for (const host of testHosts) {
      const res = await request(app).get('/api/health').set('Host', host);
      expect(res.status).toBe(200);
      expect(res.body.error).toBeUndefined();
    }
  });

  it('every response carries nosniff', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('the CSP header is applied to an HTML-document path and not to a JSON API path', async () => {
    // Create a test app to verify CSP is applied to HTML paths
    const testApp = express();
    testApp.use(securityHeaders);
    testApp.get('/', (_req, res) => {
      res.send('<!DOCTYPE html><html></html>');
    });
    testApp.get('/index.html', (_req, res) => {
      res.send('<!DOCTYPE html><html></html>');
    });
    testApp.get('/api/test', (_req, res) => {
      res.json({ test: true });
    });

    // GET / should have CSP header
    const rootRes = await request(testApp).get('/');
    expect(rootRes.headers['content-security-policy']).toBe(CSP_VALUE);

    // GET /index.html should have CSP header
    const htmlRes = await request(testApp).get('/index.html');
    expect(htmlRes.headers['content-security-policy']).toBe(CSP_VALUE);

    // GET /api/test should not have CSP header
    const apiRes = await request(testApp).get('/api/test');
    expect(apiRes.headers['content-security-policy']).toBeUndefined();
  });

  it('API responses carry no HTML CSP', async () => {
    const app = createApp(makeTestConfig());

    // GET /api/health
    const healthRes = await request(app).get('/api/health');
    expect(healthRes.headers['content-security-policy']).toBeUndefined();

    // GET /api/image (404)
    const imageRes = await request(app).get('/api/image');
    expect(imageRes.headers['content-security-policy']).toBeUndefined();
  });

  it('an unmatched /api route returns a JSON 404 NOT_FOUND envelope', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found.',
      },
    });
  });

  it('X-Powered-By is absent', async () => {
    const app = createApp(makeTestConfig());
    const res = await request(app).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('a route that throws an ApiError inside an async handler is serialised by the envelope', async () => {
    // Build a small throwaway app
    const testApp = express();
    testApp.use(securityHeaders);
    testApp.use(hostCheck);
    testApp.use(methodGuard);

    // Add a route that throws an ApiError in an async handler
    testApp.get('/test-throw', async (_req, _res) => {
      throw new ApiError('NOT_FOUND', 'This endpoint is not available');
    });

    testApp.use('/api', apiNotFoundHandler);
    testApp.use(createErrorEnvelope());

    const res = await request(testApp).get('/test-throw');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'This endpoint is not available',
      },
    });
  });

  it('a route that throws a raw ENOENT object yields 500 READ_FAILED with no leaked detail', async () => {
    // Build a small throwaway app
    const testApp = express();
    testApp.use(securityHeaders);
    testApp.use(hostCheck);
    testApp.use(methodGuard);

    // Add a route that throws a raw error
    testApp.get('/test-throw-raw', async (_req, _res) => {
      const err = new Error('ENOENT: no such file or directory');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).errno = -2;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).code = 'ENOENT';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).syscall = 'open';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).path = '/absolute/path/to/file';
      throw err;
    });

    testApp.use('/api', apiNotFoundHandler);
    testApp.use(createErrorEnvelope());

    const res = await request(testApp).get('/test-throw-raw');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'READ_FAILED',
        message: 'Read failed.',
      },
    });

    // Verify no detail is leaked
    expect(JSON.stringify(res.body)).not.toContain('ENOENT');
    expect(JSON.stringify(res.body)).not.toContain('errno');
    expect(JSON.stringify(res.body)).not.toContain('syscall');
    expect(JSON.stringify(res.body)).not.toContain('/absolute/path/to/file');
  });
});
