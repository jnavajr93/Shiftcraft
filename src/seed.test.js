/**
 * Vitest wrapper for src/seed.test.mjs.
 * See src/engine/solver.test.js for rationale.
 */
import { it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

it('seed.test.mjs: all seed suites pass', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, 'seed.test.mjs')],
    { encoding: 'utf8', cwd: resolve(__dirname, '..') },
  );
  if (result.status !== 0) {
    throw new Error(`seed.test.mjs exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
});
