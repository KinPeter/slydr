import type { SlideshowConfig } from '@slydr/shared';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';

export interface EffectiveAnimations {
  animations: boolean;
  reducedMotion: boolean;
}

export function useEffectiveAnimations(
  config: Pick<SlideshowConfig, 'animations'>,
): EffectiveAnimations {
  const reducedMotion = usePrefersReducedMotion();
  return { animations: config.animations && !reducedMotion, reducedMotion };
}
