import { useEffect, useState } from 'react';

type HealthState = { kind: 'loading' } | { kind: 'ok'; version: string } | { kind: 'error' };

/**
 * Placeholder shell — replaced by the view state machine in T024.
 * The raw fetch below is replaced by the typed API client in T025.
 */
export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { status: string; version: string }) => {
        setHealth({ kind: 'ok', version: body.version });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHealth({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Slydr</h1>
      <p data-testid="api-status">
        {health.kind === 'loading' && 'Checking the local API…'}
        {health.kind === 'ok' && `API reachable (version ${health.version})`}
        {health.kind === 'error' && 'Local API not reachable.'}
      </p>
    </main>
  );
}
