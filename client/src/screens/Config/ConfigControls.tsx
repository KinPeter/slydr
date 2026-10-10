import { Info } from 'lucide-react';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, type SlideshowConfig } from '@slydr/shared';
import { Checkbox, Slider, Button } from '../../components';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import {
  controls,
  durationLabel,
  durationValueText,
  REDUCED_MOTION_NOTE,
  RESET_DEFAULTS,
} from './copy';
import styles from './Config.module.css';

export function ConfigControls({
  config,
  onConfig,
  onReset,
}: {
  config: SlideshowConfig;
  onConfig: (patch: Partial<SlideshowConfig>) => void;
  onReset: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <section className={styles.controls}>
      <Slider
        label={controls.duration.label}
        value={config.durationSeconds}
        onValueChange={(durationSeconds) => onConfig({ durationSeconds })}
        min={MIN_DURATION_SECONDS}
        max={MAX_DURATION_SECONDS}
        step={1}
        pageStep={5}
        formatValue={durationLabel}
        formatValueText={durationValueText}
      />
      <Checkbox
        label={controls.shuffle.label}
        description={controls.shuffle.hint}
        checked={config.shuffle}
        onCheckedChange={(shuffle) => onConfig({ shuffle })}
      />
      <Checkbox
        label={controls.loop.label}
        description={controls.loop.hint}
        checked={config.loop}
        onCheckedChange={(loop) => onConfig({ loop })}
      />
      <Checkbox
        label={controls.animations.label}
        checked={config.animations}
        onCheckedChange={(animations) => onConfig({ animations })}
        note={
          reduced ? (
            <>
              <Info size={16} aria-hidden="true" /> {REDUCED_MOTION_NOTE}
            </>
          ) : undefined
        }
      />
      <Checkbox
        label={controls.fillEmptySpace.label}
        description={controls.fillEmptySpace.hint}
        checked={config.fillEmptySpace}
        onCheckedChange={(fillEmptySpace) => onConfig({ fillEmptySpace })}
      />
      <Checkbox
        label={controls.startFullScreen.label}
        checked={config.startFullScreen}
        onCheckedChange={(startFullScreen) => onConfig({ startFullScreen })}
      />
      <Checkbox
        label={controls.includeSubfolders.label}
        description={controls.includeSubfolders.hint}
        checked={config.includeSubfolders}
        onCheckedChange={(includeSubfolders) => onConfig({ includeSubfolders })}
      />
      <Button variant="ghost" onClick={onReset}>
        {RESET_DEFAULTS}
      </Button>
    </section>
  );
}
