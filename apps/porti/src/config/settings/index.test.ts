import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configStore, DEFAULT_PORTS, parsePort, withoutPort, withPort } from './index';

let home: string;
let previous: string | undefined;

beforeEach(() => {
  previous = process.env.XDG_CONFIG_HOME;
  home = mkdtempSync(join(tmpdir(), 'porti-config-'));
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

const writeConfig = (value: unknown) => {
  mkdirSync(join(home, 'porti'), { recursive: true });
  writeFileSync(join(home, 'porti', 'config.json'), JSON.stringify(value));
};

describe('porti config', () => {
  test('a first run watches 3000, 4200 and 8080', async () => {
    expect((await configStore.load()).ports.map((entry) => entry.port)).toEqual([3000, 4200, 8080]);
  });

  test('keeps well-formed ports, accepts bare numbers, drops junk and duplicates', async () => {
    writeConfig({ ports: [5173, { port: 3000, name: ' next ' }, { port: 70000 }, 'x', 5173] });
    expect((await configStore.load()).ports).toEqual([
      { port: 5173 },
      { port: 3000, name: 'next' },
    ]);
  });

  test('an emptied list stays empty', async () => {
    writeConfig({ ports: [] });
    expect((await configStore.load()).ports).toEqual([]);
  });

  test('round-trips what the settings screen saves', async () => {
    const config = await configStore.load();
    await configStore.save({
      ...config,
      ports: withPort(config.ports, { port: 5173, name: 'vite' }),
    });
    expect((await configStore.load()).ports.map((entry) => entry.port)).toEqual([
      3000, 4200, 5173, 8080,
    ]);
  });
});

describe('port helpers', () => {
  test('parsePort takes whole numbers in range only', () => {
    expect(parsePort('3000')).toBe(3000);
    expect(parsePort(' 80 ')).toBe(80);
    expect(parsePort('0')).toBeUndefined();
    expect(parsePort('65536')).toBeUndefined();
    expect(parsePort('3000abc')).toBeUndefined();
  });

  test('withPort renames in place and keeps the list sorted; withoutPort removes', () => {
    const renamed = withPort(DEFAULT_PORTS, { port: 4200, name: 'nx' });
    expect(renamed.find((entry) => entry.port === 4200)?.name).toBe('nx');
    expect(renamed.map((entry) => entry.port)).toEqual([3000, 4200, 8080]);
    expect(withoutPort(renamed, 3000).map((entry) => entry.port)).toEqual([4200, 8080]);
  });
});
