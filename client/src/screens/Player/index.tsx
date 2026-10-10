// Placeholder player screen — replaced by T030. T030 must delete this
// index.tsx when it adds index.ts re-exporting the real Player, so that
// module resolution is unambiguous.

import type { JSX } from 'react';
import { useAppActions } from '../../state/AppStateProvider';

export function Player(): JSX.Element {
  const actions = useAppActions();
  return (
    <main>
      <h1>Player (placeholder)</h1>
      <button type="button" onClick={() => actions.exitPlayer()}>
        Stop
      </button>
    </main>
  );
}
