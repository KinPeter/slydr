import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App, { App as NamedApp, AppScreens } from '../src/App';
import { installMockStorage } from './helpers/storageMock';

describe('App view switching', () => {
  it('renders the explorer screen', () => {
    const storage = installMockStorage();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Choose a folder' })).toBeInTheDocument();
    storage.dispose();
  });

  it('does not use browser history for view state', () => {
    const storage = installMockStorage();
    render(<App />);
    expect(window.location.pathname).toBe('/');
    storage.dispose();
  });

  it('keeps the application exports available', () => {
    expect(typeof App).toBe('function');
    expect(NamedApp).toBe(App);
    expect(typeof AppScreens).toBe('function');
  });
});
