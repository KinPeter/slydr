import '@testing-library/jest-dom/vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import { resetStorageForTests } from '../src/state/storage';

expect.extend(axeMatchers);

// React Testing Library only auto-cleans when Vitest globals are enabled.
// They are disabled in this repo, so unmount rendered trees explicitly.
afterEach(() => {
  cleanup();
});

afterEach(() => {
  resetStorageForTests();
});
