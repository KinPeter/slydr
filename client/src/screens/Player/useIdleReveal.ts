import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface IdleRevealOptions {
  hold?: boolean;
}
export interface IdleReveal {
  visible: boolean;
  /** Show the controls now and restart the idle timer. */
  reveal: () => void;
  holdProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onPointerUp?: (event: React.PointerEvent) => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: React.FocusEvent) => void;
  };
  overlayRef: React.RefObject<HTMLElement | null>;
}

/** Owns the player chrome's idle timer and the holds that keep it visible. */
export function useIdleReveal(timeoutMs = 2000, options: IdleRevealOptions = {}): IdleReveal {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const hoveringRef = useRef(false);
  const focusWithinRef = useRef(false);
  const hold = options.hold === true;
  const holdRef = useRef(hold);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const reveal = useCallback(() => {
    clearTimer();
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.inert = false;
      overlay.dataset.visible = 'true';
    }
    setVisible(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (holdRef.current || hoveringRef.current || focusWithinRef.current) return;
      const current = overlayRef.current;
      if (current) {
        current.inert = true;
        current.dataset.visible = 'false';
      }
      setVisible(false);
    }, timeoutMs);
  }, [clearTimer, timeoutMs]);
  const releaseHold = useCallback(() => reveal(), [reveal]);
  useEffect(() => {
    holdRef.current = hold;
    if (hold) {
      clearTimer();
      setVisible(true);
      if (overlayRef.current) {
        overlayRef.current.inert = false;
        overlayRef.current.dataset.visible = 'true';
      }
    } else reveal();
  }, [clearTimer, hold, reveal]);
  useEffect(() => {
    const onActivity = () => reveal();
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    return () => {
      clearTimer();
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('touchstart', onActivity);
    };
  }, [clearTimer, reveal]);
  return {
    visible,
    reveal,
    overlayRef,
    holdProps: {
      onPointerEnter: () => {
        hoveringRef.current = true;
        clearTimer();
        setVisible(true);
      },
      onPointerLeave: () => {
        hoveringRef.current = false;
        if (!focusWithinRef.current && !holdRef.current) releaseHold();
      },
      onPointerUp: (event) => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && event.currentTarget.contains(activeElement)) {
          activeElement.blur();
        }
      },
      onFocusCapture: () => {
        focusWithinRef.current = true;
        clearTimer();
        setVisible(true);
      },
      onBlurCapture: (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && overlayRef.current?.contains(next)) return;
        focusWithinRef.current = false;
        if (!hoveringRef.current && !holdRef.current) releaseHold();
      },
    },
  };
}
