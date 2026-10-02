import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configStore, type EnviConfig } from '../../config/settings';
import { disableFile, enableFile, resolveEnv } from './index';

let root: string;
let app: string;

const config = (overrides: Partial<EnviConfig> = {}): EnviConfig => ({
  ...configStore.defaults,
  vars: {},
  ...overrides,
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'envi-resolve-'));
  app = join(root, 'apps', 'web');
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(root, 'env.config.ts'),
    `export default { vars: { ROOT_ONLY: 'r', SHARED: 'from-root' }, required: ['DATABASE_URL'] };`,
  );
  writeFileSync(
    join(app, 'env.config.ts'),
    `export default ({ dir }) => ({ files: ['.env.shared'], vars: { SHARED: 'from-app', DIR: dir } });`,
  );
  writeFileSync(
    join(app, '.env'),
    'PORT=3000\nURL=http://localhost:$PORT\nMINE=file\nSHELL_HAS=file\n',
  );
  writeFileSync(join(app, '.env.user'), 'PORT=4000\n');
  writeFileSync(join(app, '.env.shared'), 'FROM_SHARED=yes\n');
  writeFileSync(join(app, '.env.example'), 'PORT=\nAPI_KEY=\n');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveEnv', () => {
  test('layers: your vars < files in order < env.config.ts, root then nearer', async () => {
    const result = await resolveEnv({
      cwd: app,
      env: { SHELL_HAS: 'shell' },
      config: config({ vars: { MINE: 'yours', GLOBAL: 'g' } }),
    });
    const value = (key: string) => result.env[key];

    expect(result.root).toBe(root);
    expect(value('GLOBAL')).toBe('g');
    expect(value('MINE')).toBe('file');
    expect(value('PORT')).toBe('4000');
    //? Expanded when .env was read — .env.user's PORT came later
    expect(value('URL')).toBe('http://localhost:3000');
    expect(value('FROM_SHARED')).toBe('yes');
    expect(value('SHARED')).toBe('from-app');
    expect(value('ROOT_ONLY')).toBe('r');
    expect(value('DIR')).toBe(app);

    const mine = result.vars.find((entry) => entry.key === 'MINE');
    expect(mine?.source.label).toBe('.env');
    expect(mine?.source.line).toBe(3);
    expect(mine?.shadowed.map((source) => source.label)).toEqual(['your vars']);
  });

  test("the shell's own value wins unless override is on", async () => {
    const off = await resolveEnv({ cwd: app, env: { SHELL_HAS: 'shell' }, config: config() });
    expect(off.env.SHELL_HAS).toBe('shell');
    expect(off.vars.find((entry) => entry.key === 'SHELL_HAS')?.status).toBe('kept');

    const on = await resolveEnv({
      cwd: app,
      env: { SHELL_HAS: 'shell' },
      config: config({ override: true }),
    });
    expect(on.env.SHELL_HAS).toBe('file');
    expect(on.vars.find((entry) => entry.key === 'SHELL_HAS')?.status).toBe('changed');
  });

  test('required keys come from env.config.ts and .env.example', async () => {
    const result = await resolveEnv({ cwd: app, env: {}, config: config() });
    expect(result.missing.map((entry) => entry.key).sort()).toEqual(['API_KEY', 'DATABASE_URL']);
  });

  test('disabling by name, then enabling again', async () => {
    const base = config();
    const before = await resolveEnv({ cwd: app, env: {}, config: base });
    const user = before.layers.find((layer) => layer.written === '.env.user');
    if (!user) throw new Error('no .env.user layer');

    const disabled = disableFile(base, user);
    expect(disabled.disabled).toEqual(['.env.user']);
    const after = await resolveEnv({ cwd: app, env: {}, config: disabled });
    expect(after.env.PORT).toBe('3000');
    expect(after.layers.find((layer) => layer.written === '.env.user')?.status).toBe('disabled');

    expect(enableFile(disabled, user, app).disabled).toEqual([]);
  });

  test('a missing file is listed, not an error; noProject skips env.config.ts', async () => {
    const result = await resolveEnv({
      cwd: root,
      env: {},
      config: config({ files: ['.env.nope'] }),
      noProject: true,
    });
    expect(result.layers.map((layer) => [layer.label, layer.status])).toEqual([
      ['.env.nope', 'missing'],
    ]);
    expect(result.vars).toEqual([]);
  });
});
