import { useEffect } from 'react';
export type DocumentView = 'explorer' | 'config' | 'player';
const TITLES: Record<DocumentView, string> = {
  explorer: 'Choose a folder — Slydr',
  config: 'Slide show settings — Slydr',
  player: 'Slide show — Slydr',
};
export function useDocumentTitle(view: DocumentView): void {
  useEffect(() => {
    document.title = TITLES[view];
  }, [view]);
}
