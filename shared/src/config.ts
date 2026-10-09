export interface SlideshowConfig {
  durationSeconds: number; // integer 1..30
  shuffle: boolean;
  loop: boolean;
  animations: boolean;
  fillEmptySpace: boolean;
  startFullScreen: boolean;
  includeSubfolders: boolean; // D1
}

export const DEFAULT_CONFIG: SlideshowConfig = {
  durationSeconds: 5,
  shuffle: true,
  loop: true,
  animations: true,
  fillEmptySpace: true,
  startFullScreen: true,
  includeSubfolders: false,
};

/** Inclusive lower bound for `durationSeconds` — specification §4.4, §8.2. */
export const MIN_DURATION_SECONDS = 1;

/** Inclusive upper bound for `durationSeconds` — specification §4.4, §8.2. */
export const MAX_DURATION_SECONDS = 30;

/**
 * Decision (not specified): "Coerces each boolean" is read as "produces a boolean
 * for each of the six boolean fields", not "applies JavaScript truthiness to
 * whatever value is present". A value of the wrong type is invalid and is replaced
 * by that field's default. There is no cross-type coercion anywhere in parseConfig.
 *
 * - `durationSeconds` is accepted only when `typeof value === 'number'` and
 *   `Number.isFinite(value)`. The string '7' is rejected and becomes the default 5.
 * - Each boolean field is accepted only when `typeof value === 'boolean'`.
 *   The string 'false', the string 'true', 0, 1, null and '' are all rejected
 *   and become that field's default.
 *
 * Rationale:
 * 1. The only legitimate producer of slydr.config is Slydr's own writer, which
 *    serialises a SlideshowConfig with JSON.stringify. A number round-trips as a
 *    number and a boolean as a boolean. A string where a boolean belongs does not
 *    mean "the user meant true"; it means the value is corrupt.
 * 2. Truthiness coercion is actively dangerous: Boolean('false') is true, so a
 *    hand-edited "shuffle": "false" would silently turn shuffling on. Falling
 *    back to the documented default is both safer and easier to explain.
 * 3. Number('') is 0 and Number('abc') is NaN, so numeric coercion needs its own
 *    thicket of follow-up checks and still produces surprising results. Rejecting
 *    non-numbers outright removes the thicket.
 * 4. One rule — "wrong type means default" — applies uniformly to all seven
 *    fields, making the function auditable at a glance.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

function parseDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.durationSeconds;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_DURATION_SECONDS) return MIN_DURATION_SECONDS;
  if (rounded > MAX_DURATION_SECONDS) return MAX_DURATION_SECONDS;
  return rounded;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Turn anything at all into a valid `SlideshowConfig`.
 *
 * Never throws, never mutates `input`, and always returns a fresh object with
 * exactly the seven `SlideshowConfig` keys. This is the defence against a
 * hand-edited or stale `localStorage` value (specification §6.2): a corrupt
 * value degrades silently to the defaults, field by field.
 */
export function parseConfig(input: unknown): SlideshowConfig {
  if (!isRecord(input)) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    durationSeconds: parseDuration(own(input, 'durationSeconds')),
    shuffle: parseBoolean(own(input, 'shuffle'), DEFAULT_CONFIG.shuffle),
    loop: parseBoolean(own(input, 'loop'), DEFAULT_CONFIG.loop),
    animations: parseBoolean(own(input, 'animations'), DEFAULT_CONFIG.animations),
    fillEmptySpace: parseBoolean(own(input, 'fillEmptySpace'), DEFAULT_CONFIG.fillEmptySpace),
    startFullScreen: parseBoolean(own(input, 'startFullScreen'), DEFAULT_CONFIG.startFullScreen),
    includeSubfolders: parseBoolean(
      own(input, 'includeSubfolders'),
      DEFAULT_CONFIG.includeSubfolders,
    ),
  };
}
