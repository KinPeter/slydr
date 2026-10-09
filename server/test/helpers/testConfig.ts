import type { ServerConfig } from '../../src/config/env.js';

export function makeTestConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const defaultConfig: ServerConfig = {
    port: 0, // OS-assigned for tests
    rootOverride: null,
    rootOverridden: false,
    cacheDir: '/tmp/slydr-cache',
    cacheMaxMb: 500,
    quiet: false,
  };

  return Object.freeze({ ...defaultConfig, ...overrides });
}
