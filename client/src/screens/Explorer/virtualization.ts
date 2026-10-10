import { useRef } from 'react';
export const VIRTUALIZE_ABOVE = 200;
export const DEVIRTUALIZE_BELOW = 180;
export const LIST_OVERSCAN = 8;
export const GRID_OVERSCAN = 2;
export function useVirtualizationMode(path: string, count: number): boolean {
  const mode = useRef<{ path: string; virtual: boolean } | null>(null);
  if (!mode.current || mode.current.path !== path)
    mode.current = { path, virtual: count > VIRTUALIZE_ABOVE };
  else if (mode.current.virtual && count < DEVIRTUALIZE_BELOW) mode.current.virtual = false;
  else if (!mode.current.virtual && count > VIRTUALIZE_ABOVE) mode.current.virtual = true;
  return mode.current.virtual;
}
