/**
 * Vitest wrapper for src/engine/doctor-off.test.mjs.
 * See solver.test.js for rationale.
 */
import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

it('doctor-off.test.mjs: all doctor-off suites pass', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, 'doctor-off.test.mjs')],
    { encoding: 'utf8', cwd: resolve(__dirname, '../..') },
  );
  if (result.status !== 0) {
    throw new Error(`doctor-off.test.mjs exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
});
