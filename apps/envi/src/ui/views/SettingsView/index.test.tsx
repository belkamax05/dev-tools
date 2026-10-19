import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import { configStore, type EnviConfig } from '../../../config/settings';
import type { Resolution } from '../../../core/resolve';
import type { Session } from '../../types';
import SettingsView, { type SettingsViewProps } from '.';

test('a click on a secret pattern only selects it; removing it is the panel\'s button, asked first', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  stdout.on('data', (chunk) => {
    output = Bun.stripANSI(chunk.toString());
  });
  const reporting = isMouseReporting();
  setMouseReporting(true);

  let config: EnviConfig = { ...configStore.defaults, maskPatterns: ['TOKEN', 'SECRET'] };
  const changes: EnviConfig[] = [];
  const session: Session = { tab: 'settings', selected: {}, search: {}, collapsed: [], reveal: false };
  const props = {
    //? Only the names matter to the panel: which variables here the pattern masks
    resolution: { vars: [{ key: 'ENVI_TEST_API_TOKEN' }, { key: 'ENVI_TEST_TOKEN_SECRET' }] } as unknown as Resolution,
    isLoading: false,
    config,
    cwd: '/',
    session,
    reveal: false,
    configPath: '/dev/null',
    clearTargets: [],
    onCleared: () => {},
    notify: () => {},
    reload: () => {},
    onConfigChange: (next: EnviConfig) => {
      config = next;
      changes.push(next);
    },
    onCaptureInput: () => {},
    onEdit: () => {},
    onJump: () => {},
    onToggleReveal: () => {},
  } as unknown as SettingsViewProps;

  const app = render(<SettingsView {...props} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    onRender: emitFrame,
  });
  const click = (text: string, pick: (line: string) => boolean = () => true) => {
    const lines = output.split('\n');
    const row = lines.findIndex((line) => line.includes(text) && pick(line));
    if (row < 0) throw new Error(`No click target: ${text}`);
    for (const type of ['press', 'release'] as const)
      emitMouseEvent({
        type,
        button: 'left',
        row: row + 1,
        column: (lines[row] ?? '').indexOf(text) + 2,
        ctrl: false,
        alt: false,
        shift: false,
      });
  };
  try {
    await Bun.sleep(150);
    //? The list row reads just "TOKEN"; the panel lines mention it inside longer text
    click('TOKEN', (line) => /│\s+TOKEN\s/.test(line));
    await Bun.sleep(100);
    expect(changes).toEqual([]);
    //? The shell this runs in has its own *_TOKEN names, so they are counted too
    expect(output).toMatch(/Masks \d+ here/);
    expect(output).toContain('ENVI_TEST_API_TOKEN  — shown in full without it');
    //? The other one is still masked by SECRET, so removing TOKEN would not show it
    expect(output).not.toContain('ENVI_TEST_TOKEN_SECRET  — shown in full without it');

    click('Remove');
    await Bun.sleep(100);
    expect(output).toMatch(/Stop masking names containing TOKEN\? \(\d+ values? here would show in full\)/);
    expect(changes).toEqual([]);
    stdin.write('n');
    await Bun.sleep(100);
    expect(changes).toEqual([]);

    click('Remove');
    await Bun.sleep(100);
    stdin.write('y');
    await Bun.sleep(100);
    expect(changes.at(-1)?.maskPatterns).toEqual(['SECRET']);
  } finally {
    setMouseReporting(reporting);
    app.unmount();
  }
});
