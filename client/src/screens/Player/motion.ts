import type { SwapReason } from './types';

export const FADE_SAFETY_MARGIN_MS = 150;
/** Fallback for jsdom and detached elements where computed styles are unavailable. */
export const FADE_FALLBACK_MS = 700;

export interface TransitionInput {
  animations: boolean;
  swapReason: SwapReason;
  interrupted: boolean;
}

export function transitionDuration({
  animations,
  swapReason,
  interrupted,
}: TransitionInput): string {
  if (!animations || swapReason === 'initial' || interrupted) return '0ms';
  return swapReason === 'manual' ? 'var(--dur-fast)' : 'var(--slide-transition-duration)';
}

export function parseFirstDurationMs(value: string): number | null {
  const first = value.split(',')[0]?.trim() ?? '';
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(first);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount * (match[2] === 's' ? 1000 : 1) : null;
}

export function fadeFallbackMs(el: Element | null): number {
  if (el === null) return FADE_FALLBACK_MS + FADE_SAFETY_MARGIN_MS;
  const parsed = parseFirstDurationMs(getComputedStyle(el).transitionDuration);
  return (parsed ?? FADE_FALLBACK_MS) + FADE_SAFETY_MARGIN_MS;
}
