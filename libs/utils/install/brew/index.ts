import type Installer from '../../../types/Installer';
import exec from '../../process/exec';

const installCommand = (packageName: string) => ['brew', 'install', packageName];

const brew: Installer = {
  name: 'brew',
  installCommand,
  isAvailable: async () => (await exec(['brew', '--version'])).exitCode === 0,
  //? `brew list <package>` rather than parsing `brew list`: it exits non-zero for a package brew
  //? does not own, and it answers for casks as well as formulae.
  isInstalled: async (packageName) => (await exec(['brew', 'list', packageName])).exitCode === 0,
  //? Streamed — a first install can spend minutes downloading, and brew's own progress output is
  //? the only thing that makes that wait legible.
  install: (packageName) => exec(installCommand(packageName), { stream: true }),
};

export default brew;
