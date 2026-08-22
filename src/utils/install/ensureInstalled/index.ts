import type InstallOutcome from '../../../types/InstallOutcome';
import type Installer from '../../../types/Installer';

interface EnsureInstalledOptions {
  /** Package manager to install with when the package turns out to be missing. */
  installer: Installer;
  /** Package name as that manager spells it. */
  packageName: string;
  /**
   * Presence check to trust instead of asking the manager. Pass one when what you need is a
   * capability rather than a package — `git subrepo version` succeeding, say, which is true
   * however git-subrepo reached the machine and stays true if the user later switches managers.
   */
  isInstalled?: () => Promise<boolean>;
}

/**
 * Make sure a package is usable, installing it if it is not.
 * @param options - Which package, which manager, and how to tell it is already there
 * @returns `'present'` when nothing had to be done, `'installed'` when the manager ran
 * @throws When the package is missing and cannot be installed — the manager itself is absent, the
 * install command failed, or it succeeded without making the package usable. Every message
 * carries the exact command to run by hand, because the fix always lives outside this process.
 */
const ensureInstalled = async ({
  installer,
  packageName,
  isInstalled,
}: EnsureInstalledOptions): Promise<InstallOutcome> => {
  const isPresent = isInstalled ?? (() => installer.isInstalled(packageName));
  const hint = installer.installCommand(packageName).join(' ');

  if (await isPresent()) return 'present';

  if (!(await installer.isAvailable())) {
    throw new Error(
      `${packageName} is missing and ${installer.name} is not installed on this machine, so it cannot be installed for you. Install ${installer.name} and re-run, or install ${packageName} another way. The command would have been: ${hint}`,
    );
  }

  const result = await installer.install(packageName);
  if (result.exitCode !== 0) {
    throw new Error(
      `\`${hint}\` failed with exit code ${result.exitCode}.${result.stderr ? `\n${result.stderr}` : ''}`,
    );
  }

  //? Re-check instead of trusting the exit code: a manager can install a package successfully and
  //? still leave nothing on PATH (an unlinked keg, a shell that has not been reopened), which
  //? leaves the caller exactly as broken as before but with a success message.
  if (!(await isPresent())) {
    throw new Error(
      `\`${hint}\` reported success but ${packageName} is still not usable — it is most likely installed somewhere that is not on PATH. Open a new shell and try again.`,
    );
  }

  return 'installed';
};

export default ensureInstalled;
