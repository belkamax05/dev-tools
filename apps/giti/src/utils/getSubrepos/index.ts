import { dirname, join } from 'node:path';
import type { Vendored } from '../vendored';
import gitExec from '../gitExec';

export interface Subrepo extends Vendored {
  kind: 'subrepo';
  /** Parent-repo commit that pull landed on top of. Recorded by git-subrepo, unused elsewhere. */
  parent: string;
}

/** `.gitrepo` is git-config syntax, so `git config --list` parses it for us. */
const parseGitrepo = (raw: string) => {
  const values = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq !== -1) values.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return values;
};

/**
 * List the git-subrepo vendored directories of the repository `cwd` sits in.
 *
 * Reads `.gitrepo` files directly rather than shelling out to `git subrepo status`: it needs no
 * network, and git-subrepo does not have to be installed — its own docs promise that consumers
 * of a repo never need it, only people pushing and pulling do.
 *
 * @param cwd - Any directory inside the repository
 * @returns One entry per subrepo, in the order git lists them
 * @example
 * await getSubrepos(cwd); // [{ dir: 'libs/giti', remote: 'git@github.com:…', … }]
 */
const getSubrepos = async (cwd: string): Promise<Subrepo[]> => {
  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) return [];
  const root = rootResult.stdout.trim();

  //? `--full-name` keeps the paths repo-relative whichever subdirectory git was run from.
  const listed = await gitExec(['ls-files', '--full-name', '*.gitrepo'], root);
  if (listed.exitCode !== 0) return [];

  return Promise.all(
    listed.stdout
      .split('\n')
      .filter(Boolean)
      .map(async (file) => {
        const dir = dirname(file);
        const config = await gitExec(['config', '-f', join(root, file), '--list'], root);
        const values = parseGitrepo(config.stdout);
        return {
          kind: 'subrepo' as const,
          dir,
          path: join(root, dir),
          remote: values.get('subrepo.remote') ?? '',
          branch: values.get('subrepo.branch') ?? '',
          commit: values.get('subrepo.commit') ?? '',
          parent: values.get('subrepo.parent') ?? '',
        };
      }),
  );
};

export default getSubrepos;
