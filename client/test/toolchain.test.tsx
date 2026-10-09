import { render, screen } from '@testing-library/react';
import * as shared from '@slydr/shared';
import { describe, expect, it } from 'vitest';

describe('client test project', () => {
  it('runs in a jsdom environment', () => {
    expect('window' in globalThis).toBe(true);
    expect(document.body).toBeInTheDocument();
  });

  it('renders React 19 components and supports jest-dom matchers', () => {
    render(<button type="button">Play</button>);
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('resolves @slydr/shared through its build output', () => {
    expect(typeof shared).toBe('object');
  });
});
