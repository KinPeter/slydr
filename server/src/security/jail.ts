// Jail root resolution and path containment
// This module is owned by T010 and will be fully implemented there.
// T009 provides a placeholder setJailRoot function.

let cachedJailRoot: string | null = null;

/**
 * Initialize the jail root (T010 responsibility).
 * T009 calls this once at startup with the validated absolute path.
 * This is a placeholder; the full containment logic lives in T010.
 */
export function setJailRoot(root: string): void {
  cachedJailRoot = root;
}

/**
 * Get the cached jail root (T010 responsibility).
 * This is a placeholder; T010 will implement full path containment here.
 */
export function getJailRoot(): string | null {
  return cachedJailRoot;
}
