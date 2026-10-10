import { useEffect, useRef } from 'react';

export function useRevealOnFullscreenChange(isFullscreen: boolean, reveal: () => void): void {
  const previous = useRef(isFullscreen);
  useEffect(() => {
    if (previous.current === isFullscreen) return;
    previous.current = isFullscreen;
    reveal();
  }, [isFullscreen, reveal]);
}
