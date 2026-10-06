import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { wrapCommands } from './index';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pkgi-wrap-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run the wrapper with `read` fed end-of-file instead of waiting on a terminal. */
const runWrapped = (commands: string[][]) => {
  const status = join(dir, 'status');
  const argv = wrapCommands(commands, status);
  const script = (argv[2] ?? '').replace('< /dev/tty', '< /dev/null');
  const result = Bun.spawnSync(['sh', '-c', script, ...argv.slice(3)], { cwd: dir });
  return { code: readFileSync(status, 'utf8').trim(), output: result.stdout.toString() };
};

describe('wrapCommands', () => {
  test('records the first failing exit code and stops there', () => {
    expect(
      runWrapped([
        ['sh', '-c', 'exit 3'],
        ['touch', 'after'],
      ]).code,
    ).toBe('3');
    expect(existsSync(join(dir, 'after'))).toBe(false);
  });

  test('passes arguments through as data, never as shell', () => {
    const { code, output } = runWrapped([['true'], ['echo', '$(touch pwned)', '; touch also']]);
    expect(code).toBe('0');
    expect(output).toContain('$(touch pwned) ; touch also');
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
    expect(existsSync(join(dir, 'also'))).toBe(false);
  });
});
