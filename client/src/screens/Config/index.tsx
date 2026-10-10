// Placeholder configuration screen — replaced by T029. T029 must delete
// this index.tsx when it adds index.ts re-exporting the real Config, so that
// module resolution is unambiguous.

import type { JSX } from 'react';
import { useAppActions, useAppState } from '../../state/AppStateProvider';

export function Config(): JSX.Element {
  const { selection } = useAppState();
  const actions = useAppActions();
  return (
    <main>
      <h1>Configuration (placeholder)</h1>
      <p data-testid="config-selection">{selection === null ? '(none)' : selection.name}</p>
      <p data-testid="config-selection-path">{selection === null ? '(none)' : selection.path}</p>
      <button type="button" onClick={() => actions.goToExplorer()}>
        Back to file explorer
      </button>
      <button
        type="button"
        onClick={() => {
          // Hard-coded item only so the guarded startPlayer transition is
          // reachable by hand until T029 fetches a real image list.
          actions.setPlaylist([
            {
              name: 'placeholder.jpg',
              path: 'placeholder.jpg',
              dir: '',
              size: null,
              mtimeMs: null,
            },
          ]);
          actions.startPlayer();
        }}
      >
        Play slide show
      </button>
    </main>
  );
}
