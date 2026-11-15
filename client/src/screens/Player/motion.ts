import { MIN_DURATION_SECONDS } from '@slydr/shared';
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

/**
 * Ken Burns zoom target, spec §9.4, scaled to the configured slide duration:
 * under 5 s → 1.02, 5–9 s → 1.04, 10–14 s → 1.06, 15–19 s → 1.08, 20 s and over
 * → 1.10. `parseConfig` already clamps `durationSeconds` to an integer in
 * MIN_DURATION_SECONDS..MAX_DURATION_SECONDS; the clamp here only keeps a
 * non-finite or negative value out of a bucket it cannot belong to.
 */
export function kenburnsScale(durationSeconds: number): number {
  const seconds = Number.isFinite(durationSeconds)
    ? Math.max(durationSeconds, MIN_DURATION_SECONDS)
    : MIN_DURATION_SECONDS;
  if (seconds >= 20) return 1.1;
  if (seconds >= 15) return 1.08;
  if (seconds >= 10) return 1.06;
  if (seconds >= 5) return 1.04;
  return 1.02;
}
