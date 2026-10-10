import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { App as NamedApp, AppScreens } from '../src/App';
import { installMockStorage } from './helpers/storageMock';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  const element = document.documentElement as unknown as Record<string, unknown>;
  if ('requestFullscreen' in element) {
    delete element['requestFullscreen'];
  }
});

function renderApp(): void {
  disposers.push(installMockStorage().dispose);
  render(<App />);
}

function clickButton(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

function headings(): string[] {
  return screen.getAllByRole('heading').map((h) => h.textContent ?? '');
}

describe('App view switching', () => {
  it('renders the explorer placeholder first', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Explorer (placeholder)' })).toBeInTheDocument();
  });

  it('shows the config placeholder after Select this folder', () => {
    renderApp();
    clickButton('Select this folder');
    expect(
      screen.getByRole('heading', { name: 'Configuration (placeholder)' }),
    ).toBeInTheDocument();
  });

  it('selects the current explorer path, not any other value', () => {
    renderApp();
    clickButton('Go deeper');
    expect(screen.getByTestId('explorer-path')).toHaveTextContent('Pictures');
    clickButton('Select this folder');
    expect(screen.getByTestId('config-selection')).toHaveTextContent('Pictures');
    expect(screen.getByTestId('config-selection-path')).toHaveTextContent('Pictures');
  });

  it('returns to the explorer placeholder with the same path after Back to file explorer', () => {
    renderApp();
    clickButton('Go deeper');
    clickButton('Select this folder');
    clickButton('Back to file explorer');
    expect(screen.getByRole('heading', { name: 'Explorer (placeholder)' })).toBeInTheDocument();
    expect(screen.getByTestId('explorer-path')).toHaveTextContent('Pictures');
  });

  it('shows the player placeholder after Play slide show and returns to config on Stop', () => {
    renderApp();
    clickButton('Select this folder');
    clickButton('Play slide show');
    expect(screen.getByRole('heading', { name: 'Player (placeholder)' })).toBeInTheDocument();
    clickButton('Stop');
    expect(
      screen.getByRole('heading', { name: 'Configuration (placeholder)' }),
    ).toBeInTheDocument();
  });

  it('renders exactly one screen at any time', () => {
    renderApp();
    expect(headings()).toEqual(['Explorer (placeholder)']);
    clickButton('Select this folder');
    expect(headings()).toEqual(['Configuration (placeholder)']);
    clickButton('Play slide show');
    expect(headings()).toEqual(['Player (placeholder)']);
    clickButton('Stop');
    expect(headings()).toEqual(['Configuration (placeholder)']);
    clickButton('Back to file explorer');
    expect(headings()).toEqual(['Explorer (placeholder)']);
  });

  it('does not touch window.history or add a popstate listener', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderApp();
    clickButton('Select this folder');
    clickButton('Play slide show');
    clickButton('Stop');
    clickButton('Back to file explorer');
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(addSpy.mock.calls.filter((call) => call[0] === 'popstate')).toHaveLength(0);
  });

  it('does not call requestFullscreen', () => {
    const fullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: fullscreen,
    });
    renderApp();
    clickButton('Select this folder');
    clickButton('Play slide show');
    expect(screen.getByRole('heading', { name: 'Player (placeholder)' })).toBeInTheDocument();
    expect(fullscreen).not.toHaveBeenCalled();
  });

  it('is importable as the default export, as T019 main.tsx does', () => {
    expect(typeof App).toBe('function');
    expect(NamedApp).toBe(App);
    expect(typeof AppScreens).toBe('function');
  });
});
