import { requestFullscreenSync } from '../../lib/fullscreen';

type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null };
export const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

export function getFullscreenElement(): Element | null {
  const current = document as FullscreenDocument;
  return current.fullscreenElement ?? current.webkitFullscreenElement ?? null;
}
export function isFullscreen(): boolean {
  return getFullscreenElement() !== null;
}
export function isFullscreenSupported(): boolean {
  const doc = document as Document & { webkitExitFullscreen?: () => void };
  return 'fullscreenEnabled' in document || typeof doc.webkitExitFullscreen === 'function';
}
export function exitFullscreenSafe(): void {
  const doc = document as Document & { webkitExitFullscreen?: () => void };
  try {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
    else doc.webkitExitFullscreen?.();
  } catch {
    // Fullscreen is optional.
  }
}
export { requestFullscreenSync };
