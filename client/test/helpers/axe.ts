import { axe } from 'vitest-axe';

export async function checkA11y(container: Element): Promise<void> {
  const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
  if (results.violations.length > 0) {
    throw new Error(
      results.violations.map((violation) => `${violation.id}: ${violation.help}`).join('\n'),
    );
  }
}
