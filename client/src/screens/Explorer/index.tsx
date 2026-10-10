// Placeholder explorer screen — replaced by T026. T026 must delete this
// index.tsx when it adds index.ts re-exporting the real Explorer, so that
// module resolution is unambiguous.

import type { JSX } from 'react';
import { useAppActions, useAppState } from '../../state/AppStateProvider';

export function Explorer(): JSX.Element {
  const { explorer } = useAppState();
  const actions = useAppActions();
  const name = explorer.path === '' ? 'Home' : (explorer.path.split('/').pop() ?? 'Home');
  return (
    <main>
      <h1>Explorer (placeholder)</h1>
      <p data-testid="explorer-path">{explorer.path}</p>
      <button
        type="button"
        onClick={() =>
          actions.navigateExplorer(explorer.path === '' ? 'Pictures' : `${explorer.path}/sub`)
        }
      >
        Go deeper
      </button>
      <button type="button" onClick={() => actions.selectCurrentFolder(explorer.path, name)}>
        Select this folder
      </button>
    </main>
  );
}
