// @vitest-environment node
// This file imports the Vite config (and therefore the `vite` package,
// which depends on esbuild). esbuild cannot load inside the jsdom
// environment, so this Node-only config test runs in the node environment
// while the rest of the client suite stays in jsdom.
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import rawConfig from '../vite.config';

function resolveConfig(): UserConfig {
  if (typeof rawConfig === 'function') {
    return (rawConfig as (env: { command: string; mode: string }) => UserConfig)({
      command: 'serve',
      mode: 'development',
    });
  }
  return rawConfig as UserConfig;
}

describe('vite config', () => {
  it('serves the dev server on 127.0.0.1:5173 with strictPort', () => {
    const config = resolveConfig();
    expect(config.server?.host).toBe('127.0.0.1');
    expect(config.server?.port).toBe(5173);
    expect(config.server?.strictPort).toBe(true);
  });

  it('proxies /api to http://127.0.0.1:4317', () => {
    const config = resolveConfig();
    const proxy = config.server?.proxy as Record<string, { target?: string }> | undefined;
    expect(proxy?.['/api']?.target).toBe('http://127.0.0.1:4317');
  });

  it('builds into the dist directory with sourcemaps enabled', () => {
    const config = resolveConfig();
    expect(config.build?.outDir).toBe('dist');
    expect(config.build?.sourcemap).toBe(true);
  });

  it('does not set a non-root base path', () => {
    const config = resolveConfig();
    expect(config.base === undefined || config.base === '/').toBe(true);
  });
});
