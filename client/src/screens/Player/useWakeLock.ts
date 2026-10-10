import { useEffect, useRef } from 'react';

interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}
type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  useEffect(() => {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (wakeLock === undefined) return;
    let disposed = false;
    const release = async (): Promise<void> => {
      const current = sentinel.current;
      sentinel.current = null;
      if (current !== null) {
        try {
          await current.release();
        } catch {
          /* optional API */
        }
      }
    };
    const request = async (): Promise<void> => {
      if (!active || disposed || sentinel.current !== null) return;
      try {
        const next = await wakeLock.request('screen');
        if (disposed || !active) {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel.current = next;
        next.addEventListener('release', () => {
          sentinel.current = null;
        });
      } catch {
        /* wake lock refusal is expected */
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (active) void request();
    else void release();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [active]);
}
