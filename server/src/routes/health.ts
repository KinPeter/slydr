import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Router } from 'express';
import { Router as createRouter } from 'express';
import type { HealthResponse } from '@slydr/shared';

function getPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));

  // Walk up from src/routes (dev, via tsx) or dist/routes (built)
  // Try up to 5 levels
  for (let i = 0; i < 5; i++) {
    const currentDir = path.resolve(here, ...[...Array(i)].map(() => '..'));
    const pkgPath = path.join(currentDir, 'package.json');

    try {
      const content = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content) as Record<string, unknown>;
      if (pkg.name === '@slydr/server' && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      // Continue searching
    }
  }

  return '0.0.0';
}

const VERSION = getPackageVersion();

export function createHealthRouter(): Router {
  const router = createRouter();

  router.get('/health', (_req, res) => {
    const response: HealthResponse = {
      status: 'ok',
      version: VERSION,
    };
    res.set('Cache-Control', 'no-store').json(response);
  });

  return router;
}
