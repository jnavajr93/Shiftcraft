/**
 * Vitest wrapper for src/engine/solver.test.mjs.
 * The .mjs file uses a hand-rolled assert() runner (process.exitCode = 1 on
 * failure) that vitest can't collect directly.  This wrapper spawns it as a
 * child process and fails the vitest suite if the exit code is non-zero.
 */
import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

it('solver.test.mjs: all solver suites pass', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(__dirname, 'solver.test.mjs')],
    { encoding: 'utf8', cwd: resolve(__dirname, '../..') },
  );
  if (result.status !== 0) {
    throw new Error(`solver.test.mjs exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
});
