import { useEffect, useRef } from 'react';

export function usePreloader(sources: string[], maxEntries = 1): void {
  const cache = useRef<Map<string, HTMLImageElement>>(new Map());
  useEffect(() => {
    const wanted = sources.slice(0, Math.max(0, maxEntries));
    for (const source of wanted) {
      if (cache.current.has(source)) continue;
      const image = new Image();
      image.decoding = 'async';
      image.src = source;
      void (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).catch(
        () => undefined,
      );
      cache.current.set(source, image);
    }
    for (const [source, image] of cache.current) {
      if (!wanted.includes(source)) {
        image.src = '';
        cache.current.delete(source);
      }
    }
  }, [maxEntries, sources]);
}
