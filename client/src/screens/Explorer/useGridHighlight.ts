import { useCallback, useState } from 'react';
import type { FsEntry } from '@slydr/shared';
import type { EntryHighlightState } from './useEntryHighlight';
export function useGridHighlight(
  entries: FsEntry[],
  columns: number,
  navigate: (path: string) => void,
  parentPath: string | null,
  shared?: EntryHighlightState,
) {
  const [localActiveIndex, setLocalActiveIndex] = useState(-1);
  const activeIndex = shared?.activeIndex ?? localActiveIndex;
  const setActiveIndex = shared?.setActiveIndex ?? setLocalActiveIndex;
  const move = useCallback(
    (index: number) => {
      const next = entries.length ? Math.max(0, Math.min(entries.length - 1, index)) : -1;
      setActiveIndex(next);
      if (next >= 0)
        document.getElementById(`slydr-entry-${next}`)?.scrollIntoView({ block: 'nearest' });
    },
    [entries, setActiveIndex],
  );
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      let next: number | null = null;
      if (event.key === 'ArrowRight') next = activeIndex < 0 ? 0 : activeIndex + 1;
      else if (event.key === 'ArrowLeft' && !event.altKey)
        next = activeIndex < 0 ? 0 : activeIndex - 1;
      else if (event.key === 'ArrowDown') next = activeIndex < 0 ? 0 : activeIndex + columns;
      else if (event.key === 'ArrowUp') next = activeIndex < 0 ? 0 : activeIndex - columns;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = entries.length - 1;
      if (next !== null) {
        event.preventDefault();
        move(next);
      } else if (event.key === 'Enter' && entries[activeIndex]?.type === 'folder')
        navigate(entries[activeIndex].path);
      else if (event.key === 'Backspace' || (event.key === 'ArrowLeft' && event.altKey)) {
        event.preventDefault();
        if (parentPath !== null) navigate(parentPath);
      }
    },
    [activeIndex, columns, entries, move, navigate, parentPath],
  );
  const handleEntryPointer = useCallback(
    (kind: 'click' | 'double' | 'touch', index: number) => {
      if (kind === 'click' || kind === 'touch') setActiveIndex(index);
      else if (entries[index]?.type === 'folder') navigate(entries[index].path);
    },
    [entries, navigate, setActiveIndex],
  );
  return { activeIndex, onKeyDown, handleEntryPointer };
}
