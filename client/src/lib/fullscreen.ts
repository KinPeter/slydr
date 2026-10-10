type FullscreenCapable = Element & {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function requestFullscreenSync(el: Element): void {
  const target = el as FullscreenCapable;
  try {
    const result = target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.();
    void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Fullscreen is an optional enhancement and may be refused by the browser.
  }
}
