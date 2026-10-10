export const BACK_TO_EXPLORER = 'Back to file explorer';
export const PLAY_SLIDESHOW = 'Play slide show';
export const RESET_DEFAULTS = 'Reset to defaults';
export const HOME_FOLDER = 'Home folder';
export const SCANNING = 'Scanning…';
export const NO_IMAGES = 'No playable images in this folder.';
export const SUBFOLDER_HINT = 'Turn on Include subfolders to look in the folders inside this one.';
export const UNSUPPORTED_FORMATS = 'HEIC, TIFF and RAW photos are not supported.';
export const CHOOSE_ANOTHER_FOLDER = 'Choose another folder';
export const RETRY = 'Retry';
export const TRUNCATED_NOTICE = 'Showing the first 20,000 images.';
export const RESET_ANNOUNCEMENT = 'Settings reset to defaults.';
export const REDUCED_MOTION_NOTE =
  'Your system is set to reduce motion, so the slide show plays without animations. Your choice here is kept.';
export const SCAN_ERRORS: Record<string, string> = {
  ACCESS_DENIED: 'You do not have permission to read this folder.',
  NOT_FOUND: 'That folder no longer exists.',
  NOT_A_DIRECTORY: 'That item is not a folder.',
  OUTSIDE_ROOT: 'That folder is outside your home folder.',
};
export const GENERIC_SCAN_ERROR = 'Something went wrong while scanning this folder.';

export const controls = {
  duration: { label: 'Duration for image shown' },
  shuffle: { label: 'Shuffle images', hint: 'Play them in random order' },
  loop: { label: 'Loop slide show', hint: 'Start again when all images were shown' },
  animations: { label: 'Use animations and transitions' },
  fillEmptySpace: {
    label: 'Fill empty space on screen',
    hint: 'Blurred background from the current image',
  },
  startFullScreen: { label: 'Start in full screen' },
  includeSubfolders: {
    label: 'Include subfolders',
    hint: 'Also play images from folders inside this one',
  },
} as const;

export function durationLabel(seconds: number): string {
  return `${seconds} s`;
}
export function durationValueText(seconds: number): string {
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
export function imageCount(count: number): string {
  return `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'image' : 'images'} found`;
}
