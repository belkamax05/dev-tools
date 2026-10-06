import { expect, test } from 'bun:test';

import exec from '.';

test('captures what the command printed alongside its exit code', async () => {
  const result = await exec(['echo', 'hello']);

  expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
});

test('keeps the exit code of a command that failed', async () => {
  const result = await exec(['sh', '-c', 'echo boom >&2; exit 3']);

  expect(result.exitCode).toBe(3);
  expect(result.stderr).toBe('boom');
});

test('reports a binary that is not on PATH as exit code 127 instead of throwing', async () => {
  const result = await exec(['definitely-not-a-real-binary-9fedc3ab']);

  expect(result.exitCode).toBe(127);
});

test('runs the command in the directory it was given', async () => {
  const result = await exec(['pwd'], { cwd: '/' });

  expect(result.stdout).toBe('/');
});
