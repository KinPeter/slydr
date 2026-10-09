import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';

describe('shared test project', () => {
  it('runs in a Node environment without browser globals', () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
  });

  it('can import the package entry point', () => {
    expect(typeof shared).toBe('object');
  });
});
