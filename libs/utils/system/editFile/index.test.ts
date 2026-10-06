import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('opens files through packaged IDE aliases, ignoring agy, and preserves flags and spaced paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dev-tools-editor-'));
  const output = join(directory, 'args');
  const target = join(directory, 'file with spaces.ts');
  try {
    // agy is an agent CLI, so it must not shadow the packaged IDE launcher.
    for (const command of ['agy', 'antigravity-ide', 'devin-desktop', 'custom-editor']) {
      writeFileSync(
        join(directory, command),
        '#!/bin/sh\nprintf "%s\\n" "$0" "$@" > "$EDITOR_TEST_OUTPUT"\n',
        { mode: 0o755 },
      );
    }
    for (const [helper, command, flags] of [
      ['/opt/antigravity-ide/helper', 'antigravity-ide', []],
      ['/opt/devin-desktop/helper', 'devin-desktop', []],
      ['/opt/code/helper', 'custom-editor', ['--wait']],
    ] as const) {
      // Isolate the child's environment and PATH: never launch the real IDEs.
      const result = Bun.spawnSync(
        [
          process.execPath,
          '--no-env-file',
          '--eval',
          `import editFile from ${JSON.stringify(join(import.meta.dir, 'index.ts'))}; editFile(${JSON.stringify(target)});`,
        ],
        {
          env: {
            PATH: directory,
            GIT_ASKPASS: helper,
            EDITOR: 'custom-editor --wait',
            EDITOR_TEST_OUTPUT: output,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(result.exitCode).toBe(0);
      expect(await Bun.file(output).text()).toBe(
        `${[join(directory, command), ...flags, target].join('\n')}\n`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
