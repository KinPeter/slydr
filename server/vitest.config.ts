import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
