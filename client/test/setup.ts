import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetStorageForTests } from '../src/state/storage';

// React Testing Library only auto-cleans when Vitest globals are enabled.
// They are disabled in this repo, so unmount rendered trees explicitly.
afterEach(() => {
  cleanup();
});

afterEach(() => {
  resetStorageForTests();
});
