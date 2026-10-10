import { useCallback, useEffect, useRef, useState } from 'react';
import { useExplorerScroll } from './ExplorerScrollContext';
import { requestThumbnail, type ThumbnailHandle } from './thumbnailQueue';
export type ThumbnailState = 'idle' | 'pending' | 'loaded' | 'failed';
type RecordEntry = {
  observer: IntersectionObserver;
  callbacks: Map<Element, (visible: boolean) => void>;
};
const observers = new WeakMap<Element, RecordEntry>();
function observerFor(root: Element): RecordEntry {
  const old = observers.get(root);
  if (old) return old;
  const callbacks = new Map<Element, (visible: boolean) => void>();
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => callbacks.get(entry.target)?.(entry.isIntersecting)),
    { root, rootMargin: '100% 0px', threshold: 0 },
  );
  const record = { observer, callbacks };
  observers.set(root, record);
  return record;
}
export function useThumbnail(path: string): {
  ref: (el: HTMLElement | null) => void;
  state: ThumbnailState;
  src: string | null;
  onImageLoad: () => void;
  onImageError: () => void;
} {
  const root = useExplorerScroll();
  const [state, setState] = useState<ThumbnailState>('idle');
  const stateRef = useRef<ThumbnailState>('idle');
  const [src, setSrc] = useState<string | null>(null);
  const element = useRef<HTMLElement | null>(null);
  const handle = useRef<ThumbnailHandle | null>(null);
  const url = useRef<string | null>(null);
  const updateState = useCallback((next: ThumbnailState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const ref = useCallback(
    (next: HTMLElement | null) => {
      if (element.current && root) {
        const record = observerFor(root);
        record.observer.unobserve(element.current);
        record.callbacks.delete(element.current);
      }
      if (element.current) handle.current?.cancel();
      element.current = next;
      if (next && root) {
        const record = observerFor(root);
        record.callbacks.set(next, (visible) => {
          if (visible && stateRef.current === 'idle') {
            updateState('pending');
            handle.current = requestThumbnail({
              key: path,
              onLoad: (objectUrl) => {
                url.current = objectUrl;
                setSrc(objectUrl);
                updateState('loaded');
              },
              onError: () => updateState('failed'),
            });
          } else if (!visible && stateRef.current === 'pending') {
            handle.current?.cancel();
            handle.current = null;
            updateState('idle');
          }
        });
        record.observer.observe(next);
      }
    },
    [path, root, updateState],
  );
  const onImageLoad = useCallback(() => {
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
  }, []);
  const onImageError = useCallback(() => {
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
    updateState('failed');
  }, [updateState]);
  useEffect(
    () => () => {
      if (element.current && root) observerFor(root).observer.unobserve(element.current);
      if (element.current && root) observerFor(root).callbacks.delete(element.current);
      handle.current?.cancel();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [root],
  );
  return { ref, state, src, onImageLoad, onImageError };
}
