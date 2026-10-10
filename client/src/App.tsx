import { useEffect, useRef, type JSX } from 'react';
import { AppStateProvider, useAppState } from './state/AppStateProvider';
import { Config } from './screens/Config';
import { Explorer } from './screens/Explorer';
import { Player } from './screens/Player';
import { useDocumentTitle } from './lib/useDocumentTitle';
import styles from './App.module.css';

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
  const previous = useRef<typeof view | null>(null);
  useDocumentTitle(view);
  useEffect(() => {
    const from = previous.current;
    previous.current = view;
    if (from === null || from === view) return;
    const frame = window.requestAnimationFrame(() => {
      const selector =
        view === 'explorer'
          ? '[data-focus-target="entries"]'
          : view === 'player'
            ? '[data-focus-target="player"]'
            : from === 'player'
              ? '[data-focus-target="play"]'
              : '[data-focus-target="heading"]';
      const target =
        document.querySelector<HTMLElement>(selector) ??
        document.querySelector<HTMLElement>('[data-focus-target="heading"]');
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);
  const screen = view === 'explorer' ? <Explorer /> : view === 'config' ? <Config /> : <Player />;
  return (
    <>
      <>
        {view !== 'player' && (
          <a className={styles.skipLink} href="#main">
            Skip to main content
          </a>
        )}
      </>
      <main id="main" tabIndex={-1} className={styles.main}>
        {screen}
      </main>
    </>
  );
}
