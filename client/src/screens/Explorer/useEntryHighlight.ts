import { useCallback, useState } from 'react';
import type { FsEntry } from '@slydr/shared';

export type EntryHighlightState = {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
};
export type HighlightOptions = { reveal?: (index: number) => void; pageSize?: () => number };

export function useEntryHighlight(
  entries: FsEntry[],
  navigate: (path: string) => void,
  parentPath: string | null,
  shared?: EntryHighlightState,
  options?: HighlightOptions,
) {
  const [localActiveIndex, setLocalActiveIndex] = useState(-1);
  const activeIndex = shared?.activeIndex ?? localActiveIndex;
  const setActiveIndex = shared?.setActiveIndex ?? setLocalActiveIndex;
  const move = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(entries.length - 1, index));
      setActiveIndex(entries.length ? next : -1);
      if (entries[next]) {
        if (options?.reveal) options.reveal(next);
        else document.getElementById(`slydr-entry-${next}`)?.scrollIntoView({ block: 'nearest' });
      }
    },
    [entries, options, setActiveIndex],
  );
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(activeIndex < 0 ? 0 : activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(activeIndex < 0 ? entries.length - 1 : activeIndex - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        move(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        move(entries.length - 1);
      } else if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        const size = Math.max(1, options?.pageSize?.() ?? 1);
        const base = activeIndex < 0 ? (event.key === 'PageDown' ? -1 : 0) : activeIndex;
        move(base + (event.key === 'PageDown' ? size : -size));
      } else if (event.key === 'Enter' && entries[activeIndex]?.type === 'folder')
        navigate(entries[activeIndex].path);
      else if (event.key === 'Backspace' || (event.key === 'ArrowLeft' && event.altKey)) {
        event.preventDefault();
        if (parentPath !== null) navigate(parentPath);
      }
    },
    [activeIndex, entries, move, navigate, options, parentPath],
  );
  const handleEntryPointer = useCallback(
    (kind: 'click' | 'double' | 'touch', index: number) => {
      if (kind === 'click') setActiveIndex(index);
      else if (kind === 'double' && entries[index]?.type === 'folder')
        navigate(entries[index].path);
    },
    [entries, navigate, setActiveIndex],
  );
  return { activeIndex, setActiveIndex, onKeyDown, handleEntryPointer };
}
