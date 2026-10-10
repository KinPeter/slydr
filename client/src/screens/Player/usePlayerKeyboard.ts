import { useEffect, useRef } from 'react';
import type { PlayerControls } from './types';

export interface UsePlayerKeyboardOptions {
  controls: PlayerControls;
  reveal: () => void;
}

const REPEAT_INTERVAL = 250;
const INTERACTIVE_SELECTOR = 'button, [role="button"], a[href], summary';
const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable]';

export function usePlayerKeyboard({ controls, reveal }: UsePlayerKeyboardOptions): void {
  const controlsRef = useRef(controls);
  const revealRef = useRef(reveal);
  const lastRepeatAtRef = useRef<number | null>(null);
  controlsRef.current = controls;
  revealRef.current = reveal;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TEXT_ENTRY_SELECTOR)) return;
      const focusedInteractive = target?.closest(INTERACTIVE_SELECTOR);

      const key = event.key;
      if (![' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'f', 'F'].includes(key)) return;
      if (key === ' ' && focusedInteractive) return;

      const repeat = event.repeat;
      if (repeat && (key === ' ' || key === 'f' || key === 'F' || key === 'Escape')) {
        if (key === ' ') event.preventDefault();
        revealRef.current();
        return;
      }
      if (repeat && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        const now = performance.now();
        const last = lastRepeatAtRef.current;
        if (last !== null && now - last < REPEAT_INTERVAL) {
          revealRef.current();
          return;
        }
        lastRepeatAtRef.current = now;
      }

      switch (key) {
        case ' ':
          event.preventDefault();
          controlsRef.current.togglePause();
          break;
        case 'Escape':
          controlsRef.current.stop();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          controlsRef.current.previous();
          lastRepeatAtRef.current = performance.now();
          break;
        case 'ArrowRight':
          event.preventDefault();
          controlsRef.current.next();
          lastRepeatAtRef.current = performance.now();
          break;
        case 'f':
        case 'F':
          controlsRef.current.toggleFullscreen();
          break;
      }
      revealRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
