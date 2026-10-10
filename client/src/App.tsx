import type { JSX } from 'react';
import { AppStateProvider, useAppState } from './state/AppStateProvider';
import { Config } from './screens/Config';
import { Explorer } from './screens/Explorer';
import { Player } from './screens/Player';

export function App(): JSX.Element {
  return (
    <AppStateProvider>
      <AppScreens />
    </AppStateProvider>
  );
}

export default App;

export function AppScreens(): JSX.Element {
  const { view } = useAppState();
  switch (view) {
    case 'explorer':
      return <Explorer />;
    case 'config':
      return <Config />;
    case 'player':
      return <Player />;
  }
}
