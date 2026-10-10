import { useSyncExternalStore } from 'react';

const MD_QUERY = '(min-width: 768px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(MD_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(MD_QUERY).matches : true;
}

/** `1` below 768px (current folder + overflow menu only), undefined from 768px up. */
export function useBreadcrumbCap(): number | undefined {
  const isMdUp = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return isMdUp ? undefined : 1;
}
