import { describe, expect, test } from 'bun:test';

import { captureCommand, commandLine, slugOf } from '.';

describe('command line', () => {
  test('arguments are quoted only when they need it; one argument is kept as a shell line', () => {
    expect(commandLine(['bun', 'run', 'validate', 'packages:lock'])).toBe(
      'bun run validate packages:lock',
    );
    expect(commandLine(['echo', "it's here", 'a b'])).toBe(`echo 'it'\\''s here' 'a b'`);
    expect(commandLine(['ls -la | head'])).toBe('ls -la | head');
  });

  test('slug', () => {
    expect(slugOf('bun run validate packages:lock')).toBe('bun-run-validate-packages-lock');
    expect(slugOf('$$$')).toBe('terminal');
  });
});

describe('captureCommand', () => {
  test('stdout and stderr interleave in order, colour is asked for, exit code kept', async () => {
    const { output, exitCode } = await captureCommand([
      'sh',
      '-c',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, not a template
      'echo out; echo err >&2; echo "$TERM $FORCE_COLOR ${NO_COLOR-unset}"; exit 3',
    ]);
    expect(output).toBe('out\nerr\nxterm-256color 1 unset');
    expect(exitCode).toBe(3);
  });

  test('a single argument runs as a shell line', async () => {
    const { output } = await captureCommand(['printf "a\\nb\\nc\\n" | tail -2']);
    expect(output).toBe('b\nc');
  });

  test('a timeout stops a whole shell pipeline and keeps what it printed', async () => {
    const { output, timedOut, ms } = await captureCommand(['echo early; sleep 5 | cat'], {
      timeout: 0.3,
    });
    expect(output).toBe('early');
    expect(timedOut).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  test('a command done before its timeout is not marked as timed out', async () => {
    const { output, exitCode, timedOut } = await captureCommand(['echo', 'quick'], { timeout: 5 });
    expect([output, exitCode, timedOut]).toEqual(['quick', 0, false]);
  });

  test('a command that is not there is captured as the shell reports it', async () => {
    const { output, exitCode } = await captureCommand(['definitely-not-a-command-9f3e', '--x']);
    expect(output).toContain('not found');
    expect(exitCode).toBe(127);
  });
});
