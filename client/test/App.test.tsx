import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

function mockFetchNever() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App (scaffold shell)', () => {
  it('renders the Slydr heading', () => {
    mockFetchNever();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Slydr' })).toBeInTheDocument();
  });

  it('shows "Checking the local API…" before the health request resolves', () => {
    mockFetchNever();
    render(<App />);
    expect(screen.getByTestId('api-status')).toHaveTextContent('Checking the local API…');
  });

  it('shows the version from /api/health once the request resolves', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', version: '1.2.3' }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText('API reachable (version 1.2.3)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/health');
  });

  it('shows "Local API not reachable." when the health request rejects', async () => {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown) =>
      Promise.reject(new TypeError('fetch failed')),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText('Local API not reachable.')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/health');
  });

  it('aborts the in-flight health request on unmount without logging an unhandled rejection', async () => {
    let rejectPending!: (reason?: unknown) => void;
    const pending = new Promise((_resolve, reject) => {
      rejectPending = reject;
    });
    // App catches AbortError itself, but the raw promise still rejects,
    // so attach a no-op handler to avoid an unhandled rejection in jsdom.
    pending.catch(() => {});
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      observedSignal?.addEventListener('abort', () => {
        rejectPending(new DOMException('Aborted', 'AbortError'));
      });
      return pending;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<App />);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/health');
    unmount();
    expect(observedSignal?.aborted).toBe(true);
    // Let the rejection propagate through App's catch handler.
    await Promise.resolve();
    await Promise.resolve();
  });
});
