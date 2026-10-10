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
  const doc = document as Document & {
    fullscreenEnabled?: boolean;
    webkitExitFullscreen?: () => void;
    webkitFullscreenEnabled?: boolean;
  };
  const root = document.documentElement as Element & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const standardSupported =
    typeof root.requestFullscreen === 'function' && doc.fullscreenEnabled !== false;
  const webkitSupported =
    typeof root.webkitRequestFullscreen === 'function' && doc.webkitFullscreenEnabled !== false;
  return standardSupported || webkitSupported;
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
