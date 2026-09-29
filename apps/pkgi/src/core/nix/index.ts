import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import type { PackageManagerName } from '../../config/settings';
import { type LockContents, readLockfile } from '../lockfile';
import { installCommand } from '../manifest';

/** dev-tools' generic builder — see its header for what it does with the manifest. */
export const NODE_MODULES_NIX = join(import.meta.dir, '../../../../../nix/lib/node-modules.nix');

/** Besides the lockfile and each workspace's package.json, what a manager reads while installing. */
const CONFIG_FILES = ['bunfig.toml', '.npmrc', '.yarnrc', '.yarnrc.yml', 'pnpm-workspace.yaml'];

/** Lifecycle scripts a plain install runs for the project itself, in the order it runs them. */
export const OWN_LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare'] as const;

/** Where `argv` puts the registry: the builder swaps `@REGISTRY@` for its local one. */
const REGISTRY_FLAGS: Record<PackageManagerName, { args: string[]; env: Record<string, string> }> =
  {
    bun: { args: [], env: { BUN_CONFIG_REGISTRY: '@REGISTRY@' } },
    npm: { args: ['--registry=@REGISTRY@', '--no-audit', '--no-fund'], env: {} },
    pnpm: { args: ['--registry=@REGISTRY@'], env: {} },
    yarn: { args: ['--registry', '@REGISTRY@', '--non-interactive'], env: {} },
  };

export interface NixManifest {
  name: string;
  manager: PackageManagerName;
  managerStorePath: string;
  lockfile: string;
  workspaces: string[];
  files: string[];
  tarballs: LockContents['tarballs'];
  install: {
    argv: string[];
    env: Record<string, string>;
    /** Files the build copy gets instead of the checkout's, by path from the root. */
    overlay: Record<string, string>;
  };
}

/**
 * pnpm 11 re-checks a lockfile's publish times (`minimumReleaseAge`) against registry metadata,
 * which a registry serving only the lockfile's tarballs doesn't have — and it reads that setting
 * only from pnpm-workspace.yaml. The build's copy turns it off: the tarballs are the lockfile's,
 * verified by hash, and pnpm still applies the policy when it writes the lockfile, outside Nix.
 */
const buildOverlay = async (
  root: string,
  manager: PackageManagerName,
): Promise<Record<string, string>> => {
  if (manager !== 'pnpm') return {};
  const file = Bun.file(join(root, 'pnpm-workspace.yaml'));
  const settings = (await file.exists())
    ? ((Bun.YAML.parse(await file.text()) as Record<string, unknown> | null) ?? {})
    : {};
  return { 'pnpm-workspace.yaml': Bun.YAML.stringify({ ...settings, minimumReleaseAge: 0 }) };
};

/**
 * The Nix store package `manager` on `PATH` comes from — the pinned one inside a Nix shell. The
 * build uses exactly that one, so its version is part of what the output depends on.
 */
export const managerStorePath = (manager: PackageManagerName): string => {
  const found = Bun.which(manager);
  const real = found && realpathSync(found);
  const match = real?.match(/^\/nix\/store\/[^/]+/);
  if (!match) {
    throw new Error(
      `${manager} on PATH (${found ?? 'none'}) isn't from the Nix store — run this inside the repo's Nix shell`,
    );
  }
  return match[0];
};

/** The patch files `patchedDependencies` names, from package.json and (bun, pnpm) the lockfile's copy of it. */
const patchFiles = async (root: string): Promise<string[]> => {
  try {
    const pkg = (await Bun.file(join(root, 'package.json')).json()) as {
      patchedDependencies?: Record<string, string>;
      pnpm?: { patchedDependencies?: Record<string, string> };
    };
    return Object.values({ ...pkg.patchedDependencies, ...pkg.pnpm?.patchedDependencies });
  } catch {
    return [];
  }
};

/** Every file the install reads, relative to the root: the build copies only these. */
export const installInputs = async (
  root: string,
  lockfile: string,
  workspaces: string[],
): Promise<string[]> => {
  const files = [
    relative(root, lockfile),
    ...workspaces.map((dir) => (dir ? `${dir}/package.json` : 'package.json')),
    ...CONFIG_FILES,
    ...(await patchFiles(root)),
  ];
  return [...new Set(files)].filter((file) => existsSync(join(root, file))).sort();
};

export const buildManifest = async (
  root: string,
  manager: PackageManagerName,
  lockfile: string,
  managerVersion?: string,
): Promise<NixManifest> => {
  const contents = await readLockfile(root, manager, lockfile);
  if (contents.unsupported.length) {
    throw new Error(
      `${basename(lockfile)} pins ${contents.unsupported.length} package(s) no tarball + hash can stand for, so Nix can't fetch them:\n  ${contents.unsupported.slice(0, 10).join('\n  ')}`,
    );
  }
  const frozen = installCommand(manager, { frozen: true, version: managerVersion, dir: root });
  const { args, env } = REGISTRY_FLAGS[manager];
  return {
    name: basename(root).replace(/[^\w.+-]/g, '-'),
    manager,
    managerStorePath: managerStorePath(manager),
    lockfile: relative(root, lockfile),
    workspaces: contents.workspaces,
    files: await installInputs(root, lockfile, contents.workspaces),
    tarballs: contents.tarballs,
    install: { argv: [...frozen, ...args], env, overlay: await buildOverlay(root, manager) },
  };
};

/** pkgi's own files for a root: manifests and the out-links that keep builds from garbage collection. */
export const nixCacheDir = (root: string) => join(root, '.cache', 'pkgi', 'nix');

/** `nix-build` the manifest; the build log goes to the terminal, the store path comes back. */
export const buildNodeModules = async (
  root: string,
  manifest: NixManifest,
  key: string,
): Promise<string> => {
  const dir = nixCacheDir(root);
  await mkdir(dir, { recursive: true });
  const manifestFile = join(dir, `${key}.json`);
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const child = Bun.spawn(
    [
      'nix-build',
      NODE_MODULES_NIX,
      '--argstr',
      'manifest',
      manifestFile,
      '--argstr',
      'root',
      root,
      '--out-link',
      join(dir, `${key}-node-modules`),
      //? One fetch per tarball: thousands on a first build, and a default max-jobs of 1 would
      //? download them one at a time.
      '--max-jobs',
      'auto',
    ],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' },
  );
  const out = (await new Response(child.stdout).text()).trim();
  if ((await child.exited) !== 0 || !out.startsWith('/nix/store/')) {
    throw new Error('nix-build of node_modules failed — see above');
  }
  return out;
};

/** Keep the newest `keep` builds' out-links (so switching back is instant); drop the rest. */
export const pruneBuilds = async (root: string, keep = 5) => {
  const dir = nixCacheDir(root);
  const links = (await readdir(dir)).filter((name) => name.endsWith('-node-modules'));
  const dated = await Promise.all(
    links.map(async (name) => ({
      name,
      at: (await stat(join(dir, name)).catch(() => undefined))?.mtimeMs ?? 0,
    })),
  );
  for (const { name } of dated.sort((a, b) => b.at - a.at).slice(keep)) {
    await rm(join(dir, name), { force: true });
    await rm(join(dir, name.replace(/-node-modules$/, '.json')), { force: true });
  }
};

/**
 * Put a build's node_modules in place for every workspace: copied (not linked — relative
 * workspace links must resolve inside the checkout) into `node_modules.pkgi-new`, made writable
 * so the manager can still change it, then swapped in. A workspace the build has none for loses
 * its old one.
 */
export const placeNodeModules = async (root: string, out: string, workspaces: string[]) => {
  for (const dir of workspaces) {
    const target = join(root, dir, 'node_modules');
    const built = join(out, dir, 'node_modules');
    const fresh = `${target}.pkgi-new`;
    const old = `${target}.pkgi-old`;
    await rm(fresh, { recursive: true, force: true });
    await rm(old, { recursive: true, force: true });
    if (existsSync(built)) {
      const copy = await exec(['cp', '-RP', '--preserve=mode', built, fresh]);
      if (copy.exitCode !== 0) throw new Error(`copying ${built}: ${copy.stderr}`);
      await exec(['chmod', '-R', 'u+w', fresh]);
    }
    if (existsSync(target)) await rename(target, old);
    if (existsSync(fresh)) await rename(fresh, target);
    await rm(old, { recursive: true, force: true });
  }
};
