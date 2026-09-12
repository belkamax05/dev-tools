import { join } from 'node:path';
import type { Vendored } from '../vendored';
import gitExec from '../gitExec';

/**
 * List the git submodules of the repository `cwd` sits in.
 *
 * `.gitmodules` carries the path and URL; the pinned commit lives in the tree as a gitlink
 * (mode 160000) rather than in the file, so both have to be read. A submodule without an explicit
 * `branch` tracks whatever `git submodule update --remote` defaults to, which is `HEAD`.
 *
 * @param cwd - Any directory inside the repository
 * @returns One entry per submodule declared in `.gitmodules`
 */
const getSubmodules = async (cwd: string): Promise<Vendored[]> => {
  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) return [];
  const root = rootResult.stdout.trim();

  const config = await gitExec(['config', '-f', join(root, '.gitmodules'), '--list'], root);
  if (config.exitCode !== 0) return [];

  //? Keys are `submodule.<name>.<field>`, and <name> may itself contain dots, so the field is
  //? taken from the end rather than by splitting on every dot.
  const byName = new Map<string, Map<string, string>>();
  for (const line of config.stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (!key.startsWith('submodule.')) continue;

    const lastDot = key.lastIndexOf('.');
    const name = key.slice('submodule.'.length, lastDot);
    const field = key.slice(lastDot + 1);
    const fields = byName.get(name) ?? new Map<string, string>();
    fields.set(field, value);
    byName.set(name, fields);
  }

  const links = await gitExec(['ls-files', '--full-name', '-s'], root);
  const pinned = new Map<string, string>();
  if (links.exitCode === 0) {
    for (const line of links.stdout.split('\n')) {
      //? "<mode> <sha> <stage>\t<path>" — 160000 is git's mode for a gitlink.
      if (!line.startsWith('160000 ')) continue;
      const [meta = '', path = ''] = line.split('\t');
      pinned.set(path, meta.split(' ')[1] ?? '');
    }
  }

  return [...byName.values()].flatMap((fields) => {
    const dir = fields.get('path');
    if (!dir) return [];
    return [
      {
        kind: 'submodule' as const,
        dir,
        path: join(root, dir),
        remote: fields.get('url') ?? '',
        branch: fields.get('branch') ?? '',
        commit: pinned.get(dir) ?? '',
      },
    ];
  });
};

export default getSubmodules;
