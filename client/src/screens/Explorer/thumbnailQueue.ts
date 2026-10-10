import { DEFAULT_THUMB_SIZE, fetchThumbnailBlob, isAbortError } from '../../api/client';

export const MAX_IN_FLIGHT = 6;
export interface ThumbnailHandle {
  cancel(): void;
}
export interface ThumbnailRequest {
  key: string;
  onLoad: (url: string) => void;
  onError: () => void;
}
interface Entry {
  request: ThumbnailRequest;
  cancelled: boolean;
  controller?: AbortController;
}
const queue = new Map<string, Entry>();
const inFlight = new Map<string, Entry>();

function drain(): void {
  while (inFlight.size < MAX_IN_FLIGHT && queue.size) {
    const next = queue.entries().next().value as [string, Entry] | undefined;
    if (!next) return;
    queue.delete(next[0]);
    const [key, entry] = next;
    const controller = new AbortController();
    entry.controller = controller;
    inFlight.set(key, entry);
    void (async () => {
      try {
        const blob = await fetchThumbnailBlob(key, DEFAULT_THUMB_SIZE, controller.signal);
        if (!controller.signal.aborted && !entry.cancelled)
          entry.request.onLoad(URL.createObjectURL(blob));
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted && !entry.cancelled)
          entry.request.onError();
      } finally {
        if (inFlight.get(key) === entry) inFlight.delete(key);
        drain();
      }
    })();
  }
}

export function requestThumbnail(request: ThumbnailRequest): ThumbnailHandle {
  // A cancelled request remains in the map until its promise settles in some
  // implementations of fetch. It must not capture a new subscriber.
  const queued = queue.get(request.key);
  const running = inFlight.get(request.key);
  const existing = queued ?? (running && !running.cancelled ? running : undefined);
  if (existing) {
    existing.request = request;
    return { cancel: () => cancel(request.key, existing) };
  }
  const entry: Entry = { request, cancelled: false };
  queue.set(request.key, entry);
  drain();
  return { cancel: () => cancel(request.key, entry) };
}
function cancel(key: string, entry: Entry): void {
  if (entry.cancelled) return;
  entry.cancelled = true;
  if (queue.get(key) === entry) queue.delete(key);
  if (inFlight.get(key) === entry) {
    // Release the slot synchronously. Abort is allowed to settle later, and a
    // tile which re-enters must be able to start a fresh request immediately.
    inFlight.delete(key);
    entry.controller?.abort();
  }
  drain();
}
export function cancelAllThumbnails(): void {
  queue.clear();
  for (const [key, entry] of inFlight) {
    entry.cancelled = true;
    inFlight.delete(key);
    entry.controller?.abort();
  }
  drain();
}
export function __inFlightCount(): number {
  return inFlight.size;
}
export function __queueLength(): number {
  return queue.size;
}
export function __reset(): void {
  cancelAllThumbnails();
  queue.clear();
  inFlight.clear();
}
