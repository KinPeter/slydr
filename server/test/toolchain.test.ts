import express from 'express';
import request from 'supertest';
import * as shared from '@slydr/shared';
import { describe, expect, it } from 'vitest';

describe('server test project', () => {
  it('runs in a Node environment without browser globals', () => {
    expect('window' in globalThis).toBe(false);
    expect(process.versions.node).toMatch(/^\d+\./);
  });

  it('resolves @slydr/shared through its build output', () => {
    expect(typeof shared).toBe('object');
  });

  it('can drive an Express 5 app through Supertest', async () => {
    const app = express();
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    const response = await request(app).get('/ping');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
