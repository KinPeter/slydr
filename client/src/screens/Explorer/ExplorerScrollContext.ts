import { createContext, useContext } from 'react';
export const ExplorerScrollContext = createContext<HTMLElement | null>(null);
export function useExplorerScroll(): HTMLElement | null {
  return useContext(ExplorerScrollContext);
}
