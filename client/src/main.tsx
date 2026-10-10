import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import App from './App';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Slydr: #root container missing from index.html');
  }
  const root = createRoot(container);
  // Dev-only component gallery (T022): the dynamic import keeps it out of the
  // production bundle (Vite drops the DEV branch at build time).
  if (import.meta.env.DEV && window.location.hash === '#/gallery') {
    const { Gallery } = await import('./components/gallery/Gallery');
    root.render(
      <StrictMode>
        <Gallery />
      </StrictMode>,
    );
  } else {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}

void bootstrap();
