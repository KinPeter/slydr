// Conditional class-name helper (owned by T020). Joins truthy class names
// with a single space; falsy parts (false, null, undefined, '') are skipped.
// Used in place of a classnames/clsx dependency.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
