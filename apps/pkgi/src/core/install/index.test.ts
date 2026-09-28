import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isInstallCurrent, managerVersionMismatch, stampPath, writeInstallStamp } from './index';

let root: string;
let lockfile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pkgi-install-'));
  lockfile = join(root, 'bun.lock');
  writeFileSync(lockfile, '{ "lockfileVersion": 1 }');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('install stamp', () => {
  test('current only after an install from this very lockfile, by this manager', async () => {
    expect(await isInstallCurrent(root, 'bun', lockfile)).toBe(false);
    await writeInstallStamp(root, 'bun', lockfile);
    expect(await isInstallCurrent(root, 'bun', lockfile)).toBe(true);
    expect(await isInstallCurrent(root, 'npm', lockfile)).toBe(false);
    writeFileSync(lockfile, '{ "lockfileVersion": 1, "changed": true }');
    expect(await isInstallCurrent(root, 'bun', lockfile)).toBe(false);
  });

  test('no lockfile, or no node_modules, is never current', async () => {
    await writeInstallStamp(root, 'bun', lockfile);
    expect(await isInstallCurrent(root, 'bun', undefined)).toBe(false);
    rmSync(join(root, 'node_modules'), { recursive: true });
    expect(await isInstallCurrent(root, 'bun', lockfile)).toBe(false);
  });

  test('a broken stamp is not current', async () => {
    await writeInstallStamp(root, 'bun', lockfile);
    writeFileSync(stampPath(root), 'not json');
    expect(await isInstallCurrent(root, 'bun', lockfile)).toBe(false);
  });
});

describe('managerVersionMismatch', () => {
  test('nothing pinned, nothing to compare', async () => {
    expect(await managerVersionMismatch('bun', undefined)).toBeUndefined();
  });

  test('reports the bun on PATH when it is not the pinned one', async () => {
    expect(await managerVersionMismatch('bun', Bun.version)).toBeUndefined();
    expect(await managerVersionMismatch('bun', '0.0.1')).toBe(Bun.version);
  });
});
