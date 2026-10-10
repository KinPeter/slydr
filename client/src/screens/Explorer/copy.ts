export const EXPLORER_HEADING = 'Choose a folder';
export const SELECT_FOLDER = 'Select this folder';
export const SHOW_HIDDEN = 'Show hidden items';
export const LIST_VIEW = 'List view';
export const GRID_VIEW = 'Grid view';
export const FOLDER_CONTENTS = 'Folder contents';
export const EMPTY_FOLDER = 'This folder is empty.';
export const HIDDEN_EMPTY = 'Some items may be hidden. Turn on Show hidden items to see them.';
export const RESTORE_NOTICE =
  'The folder you last used is no longer available. Showing your home folder instead.';
export const TRUNCATION_NOTICE =
  'This folder has more than 10,000 items. Showing the first 10,000.';
export const RETRY = 'Retry';

export function imageCount(count: number): string {
  if (count === 0) return 'No images';
  return `${new Intl.NumberFormat().format(count)} image${count === 1 ? '' : 's'}`;
}
