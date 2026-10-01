import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import type { PackageManagerName } from '../../config/settings';
import { DEFAULT_REGISTRY, forPlatform, readLockfile, type Tarball } from '../lockfile';
import { installCommand } from '../manifest';
import { authFor, type RegistryAuth, readNpmrcAuth } from '../npmrc';

/** dev-tools' generic builder — see its header for what it does with the manifest. */
export const NODE_MODULES_NIX = join(import.meta.dir, '../../../../../nix/lib/node-modules.nix');

/**
 * Besides the lockfile and each workspace's package.json, what a manager reads while installing.
 * `.npmrc` isn't one of them: it can hold credentials, so the build gets a copy without them
 * through `buildOverlay` instead.
 */
const CONFIG_FILES = ['bunfig.toml', '.yarnrc', '.yarnrc.yml', 'pnpm-workspace.yaml'];

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
  /**
   * `storeName`, when set, is the store name the builder's fetch must use — set for archives
   * `prefetchAuthenticated` already put in the store, so the name matches the path it added.
   */
  tarballs: (Pick<Tarball, 'name' | 'version' | 'url' | 'integrity'> & { storeName?: string })[];
  install: {
    argv: string[];
    env: Record<string, string>;
    /** Files the build copy gets instead of the checkout's, by path from the root. */
    overlay: Record<string, string>;
    /**
     * Registries other than the default the archives come from (`https://host/`), and the build
     * copy's files that name them — see `otherRegistries`.
     */
    rehost: { origins: string[]; files: string[] };
  };
}

/**
 * - `.npmrc` without its credential lines (`_authToken`, `_auth`, `_password`, `username`): every
 *   install input lands in the world-readable Nix store, and the build needs no credentials — its
 *   registry is the local one, and archives behind credentials are fetched before it (see
 *   `prefetchAuthenticated`). The checkout's `.npmrc` is never one of `files` for that reason.
 * - pnpm 11 re-checks a lockfile's publish times (`minimumReleaseAge`) against registry metadata,
 *   which a registry serving only the lockfile's tarballs doesn't have — and it reads that setting
 *   only from pnpm-workspace.yaml. The build's copy turns it off: the tarballs are the lockfile's,
 *   verified by hash, and pnpm still applies the policy when it writes the lockfile, outside Nix.
 */
const buildOverlay = async (
  root: string,
  manager: PackageManagerName,
): Promise<Record<string, string>> => {
  const overlay: Record<string, string> = {};
  const npmrc = Bun.file(join(root, '.npmrc'));
  if (await npmrc.exists()) {
    overlay['.npmrc'] = (await npmrc.text())
      .split(/\r?\n/)
      .filter((line) => !/:(_authToken|_auth|_password|username)\s*=|^\s*_auth/.test(line))
      .join('\n');
  }
  if (manager !== 'pnpm') return overlay;
  const file = Bun.file(join(root, 'pnpm-workspace.yaml'));
  const settings = (await file.exists())
    ? ((Bun.YAML.parse(await file.text()) as Record<string, unknown> | null) ?? {})
    : {};
  overlay['pnpm-workspace.yaml'] = Bun.YAML.stringify({ ...settings, minimumReleaseAge: 0 });
  return overlay;
};

/**
 * The origins of archives from any registry but the default one — an `.npmrc` scope's, like
 * `@acme:registry=https://npm.example/repo/`. The registry flag in `REGISTRY_FLAGS` only moves the
 * default registry to the build's local one; the lockfile (bun writes such an archive's full URL)
 * and the manager config still send these to their own host, which the sandbox can't reach. The
 * builder rewrites each origin to the local registry in `files` of its copy — the lockfile and
 * manager config, never the checkout's — and since the local registry serves every archive at
 * its URL's own path, nothing else has to change.
 */
const otherRegistries = (
  tarballs: { url: string }[],
  files: string[],
  lockfile: string,
  overlaid: string[],
) => {
  const origins = new Set<string>();
  for (const { url } of tarballs) {
    const origin = `${new URL(url).origin}/`;
    if (origin !== `${DEFAULT_REGISTRY}/`) origins.add(origin);
  }
  return {
    origins: [...origins].sort(),
    files: origins.size
      ? [...files.filter((file) => file === lockfile || CONFIG_FILES.includes(file)), ...overlaid]
      : [],
  };
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
  const files = await installInputs(root, lockfile, contents.workspaces);
  const overlay = await buildOverlay(root, manager);
  const tarballs = forPlatform(contents.tarballs).map(({ name, version, url, integrity }) => ({
    name,
    version,
    url,
    integrity,
  }));
  return {
    name: basename(root).replace(/[^\w.+-]/g, '-'),
    manager,
    managerStorePath: managerStorePath(manager),
    lockfile: relative(root, lockfile),
    workspaces: contents.workspaces,
    files,
    tarballs,
    install: {
      argv: [...frozen, ...args],
      env,
      overlay,
      rehost: otherRegistries(tarballs, files, relative(root, lockfile), Object.keys(overlay)),
    },
  };
};

/** pkgi's own files for a root: manifests and the out-links that keep builds from garbage collection. */
export const nixCacheDir = (root: string) => join(root, '.cache', 'pkgi', 'nix');

/**
 * A store name for an archive URL, as nixpkgs' `lib.strings.sanitizeDerivationName` makes one:
 * characters a store path can't hold become `-`, no leading dot, at most 207 characters.
 */
export const storeNameOf = (url: string) =>
  basename(url)
    .replace(/[^A-Za-z0-9+._?=-]+/g, '-')
    .replace(/^\.+/, '')
    .slice(-207) || 'unknown';

/** Run `fn` over `items`, at most `limit` at a time. */
const inBatches = async <T>(items: T[], limit: number, fn: (item: T) => Promise<void>) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await fn(item);
    }),
  );
};

/**
 * Archives behind registry credentials (an `.npmrc` `//host/:_auth`/`_authToken`), put in the
 * store before the build. The builder's fetches run in Nix's sandbox, which never sees `.npmrc` —
 * so they would get a 401. Instead pkgi downloads each one here with the credentials, checks it
 * against the lockfile's integrity, and adds it with `nix-store --add-fixed`: the same
 * fixed-output path the builder's `fetchurl` resolves to, so Nix finds it already there and
 * downloads nothing. One already in the store isn't downloaded again. Returns the manifest with
 * `storeName` set on those archives.
 */
export const prefetchAuthenticated = async (
  root: string,
  manifest: NixManifest,
  auths?: RegistryAuth[],
): Promise<NixManifest> => {
  const credentials = auths ?? (await readNpmrcAuth(root));
  if (!credentials.length) return manifest;
  const tarballs = manifest.tarballs.map((t) =>
    authFor(t.url, credentials) ? { ...t, storeName: storeNameOf(t.url) } : t,
  );
  const authed = tarballs.filter((t) => t.storeName);
  if (!authed.length) return manifest;

  const dir = await mkdtemp(join(tmpdir(), 'pkgi-prefetch-'));
  const failed: string[] = [];
  try {
    await inBatches(authed, 8, async (t) => {
      const name = t.storeName as string;
      const algo = t.integrity.slice(0, t.integrity.indexOf('-'));
      const path = await exec(['nix-store', '--print-fixed-path', algo, t.integrity, name]);
      if (path.exitCode === 0 && existsSync(path.stdout)) return;
      const auth = authFor(t.url, credentials) as RegistryAuth;
      const response = await fetch(t.url, { headers: { authorization: auth.header } });
      if (!response.ok) {
        failed.push(`${t.url}: HTTP ${response.status}`);
        return;
      }
      const body = await response.arrayBuffer();
      const digest = new Bun.CryptoHasher(algo as 'sha512').update(body).digest('base64');
      if (`${algo}-${digest}` !== t.integrity) {
        failed.push(`${t.url}: doesn't match the lockfile's ${algo} integrity`);
        return;
      }
      const file = join(dir, name);
      await Bun.write(file, body);
      const added = await exec(['nix-store', '--add-fixed', algo, file]);
      if (added.exitCode !== 0) failed.push(`${t.url}: nix-store --add-fixed: ${added.stderr}`);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (failed.length) {
    throw new Error(
      `couldn't fetch ${failed.length} archive(s) behind .npmrc credentials:\n  ${failed.join('\n  ')}`,
    );
  }
  console.log(`pkgi: ${authed.length} archive(s) behind .npmrc credentials are in the store`);
  return { ...manifest, tarballs };
};

/**
 * What a failed build of a manifest is remembered by: the manifest itself (the lockfile's
 * archives, the manager, the install inputs) plus the credentials it was fetched with — so
 * changing any of them, or fixing `.npmrc`, tries again, but nothing else does.
 */
const failureKey = async (manifest: NixManifest, auths: RegistryAuth[]) =>
  new Bun.CryptoHasher('sha256')
    .update(JSON.stringify({ manifest, auths: auths.map((a) => a.prefix + a.header) }))
    .digest('hex');

const failureFile = (root: string, key: string) => join(nixCacheDir(root), `${key}.failed`);

/**
 * True when the last build of exactly this manifest, with these credentials, failed — so an
 * automatic `--if-changed` run (the Nix shell's, on every direnv load) doesn't redo a long build
 * that will fail the same way. Running `pkgi install --nix` by hand always tries again.
 */
export const failedBefore = async (root: string, manifest: NixManifest, auths: RegistryAuth[]) =>
  existsSync(failureFile(root, await failureKey(manifest, auths)));

export const recordFailure = async (
  root: string,
  manifest: NixManifest,
  auths: RegistryAuth[],
  message: string,
) => {
  await mkdir(nixCacheDir(root), { recursive: true });
  await writeFile(
    failureFile(root, await failureKey(manifest, auths)),
    `${new Date().toISOString()}\n${message}\n`,
  );
};

/** Forget every recorded failure for a root — after a build that worked. */
export const clearFailures = async (root: string) => {
  const dir = nixCacheDir(root);
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    if (name.endsWith('.failed')) await rm(join(dir, name), { force: true });
  }
};

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
 * `rm -rf` that also works on a copy out of the Nix store: its folders are read-only, so a copy
 * left behind before it was made writable (an interrupted install) fails with EACCES otherwise.
 */
const removeTree = async (path: string) => {
  if (!existsSync(path)) return;
  await exec(['chmod', '-R', 'u+w', path]);
  await rm(path, { recursive: true, force: true });
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
    await removeTree(fresh);
    await removeTree(old);
    if (existsSync(built)) {
      const copy = await exec(['cp', '-RP', '--preserve=mode', built, fresh]);
      if (copy.exitCode !== 0) throw new Error(`copying ${built}: ${copy.stderr}`);
      await exec(['chmod', '-R', 'u+w', fresh]);
    }
    if (existsSync(target)) await rename(target, old);
    if (existsSync(fresh)) await rename(fresh, target);
    await removeTree(old);
  }
};
