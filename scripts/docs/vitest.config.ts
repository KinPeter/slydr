import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tooling',
    environment: 'node',
    include: ['test/**/*.test.mjs'],
  },
});
