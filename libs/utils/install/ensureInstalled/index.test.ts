import { expect, test } from 'bun:test';

import type ExecResult from '../../../types/ExecResult';
import type Installer from '../../../types/Installer';
import ensureInstalled from '.';

interface FakeInstallerOverrides {
  isAvailable?: boolean;
  installedBefore?: boolean;
  installedAfter?: boolean;
  installResult?: ExecResult;
}

const ok: ExecResult = { stdout: '', stderr: '', exitCode: 0 };

/** An installer that records what was asked of it and flips to "installed" once `install` runs. */
const fakeInstaller = (overrides: FakeInstallerOverrides = {}) => {
  const {
    isAvailable = true,
    installedBefore = false,
    installedAfter = true,
    installResult = ok,
  } = overrides;

  const calls: string[] = [];
  let installed = installedBefore;

  const installer: Installer = {
    name: 'fake',
    installCommand: (packageName) => ['fake', 'install', packageName],
    isAvailable: async () => {
      calls.push('isAvailable');
      return isAvailable;
    },
    isInstalled: async () => {
      calls.push('isInstalled');
      return installed;
    },
    install: async () => {
      calls.push('install');
      installed = installedAfter;
      return installResult;
    },
  };

  return { installer, calls };
};

test('leaves an already installed package alone instead of reinstalling it', async () => {
  const { installer, calls } = fakeInstaller({ installedBefore: true });

  expect(await ensureInstalled({ installer, packageName: 'thing' })).toBe('present');
  expect(calls).toEqual(['isInstalled']);
});

test('installs a missing package and confirms it took', async () => {
  const { installer, calls } = fakeInstaller();

  expect(await ensureInstalled({ installer, packageName: 'thing' })).toBe('installed');
  expect(calls).toEqual(['isInstalled', 'isAvailable', 'install', 'isInstalled']);
});

test("asks the caller's own check rather than the package manager when one is given", async () => {
  const { installer, calls } = fakeInstaller();

  const outcome = await ensureInstalled({
    installer,
    packageName: 'thing',
    isInstalled: async () => true,
  });

  expect(outcome).toBe('present');
  expect(calls).toEqual([]);
});

test('names the command to run by hand when the package manager itself is missing', async () => {
  const { installer, calls } = fakeInstaller({ isAvailable: false });

  await expect(ensureInstalled({ installer, packageName: 'thing' })).rejects.toThrow(
    'fake install thing',
  );
  expect(calls).not.toContain('install');
});

test('surfaces the package manager stderr when the install command fails', async () => {
  const { installer } = fakeInstaller({
    installResult: { stdout: '', stderr: 'No available formula', exitCode: 1 },
  });

  await expect(ensureInstalled({ installer, packageName: 'thing' })).rejects.toThrow(
    'No available formula',
  );
});

test('refuses to report success when the install left nothing usable behind', async () => {
  const { installer } = fakeInstaller({ installedAfter: false });

  await expect(ensureInstalled({ installer, packageName: 'thing' })).rejects.toThrow(
    'still not usable',
  );
});
