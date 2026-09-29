import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import {
  type DependencyType,
  loadFolderContext,
  PROJECT_CONFIG_TEMPLATE,
  TAB_IDS,
  type TabId,
  writeFolderState,
} from './config/settings';
import { buildComparison, cellVersion, loadColumns, toAbsolute } from './core/compare';
import {
  hashFile,
  isInstallCurrent,
  managerVersionMismatch,
  stampPath,
  writeInstallStamp,
} from './core/install';
import {
  addCommand,
  detectPackageManager,
  findLockfile,
  installCommand,
  lockfileOnlyCommand,
  readManifest,
  removeCommand,
  setVersionCommand,
  shellQuote,
} from './core/manifest';
import {
  buildManifest,
  buildNodeModules,
  OWN_LIFECYCLE,
  placeNodeModules,
  pruneBuilds,
} from './core/nix';
import { buildRows, fetchInfos, isOutdated } from './core/packages';

const HELP = `pkgi — the packages of the folder you are in: installed, latest, notes, compare

usage:
  pkgi                            open the dashboard
  pkgi <tab>                      open it on a tab: ${TAB_IDS.join(', ')}
  pkgi list [--outdated] [--offline] [--json]
                                  every dependency: declared, installed, latest
  pkgi outdated [--json]          the ones with a newer version; exits 1 when there are any
  pkgi update <pkg>[@version]...  move packages to a version (latest by default), keeping
                                  their section and range style (^, ~, exact)
  pkgi install [--frozen | --nix] [--if-changed] [--print-watched]
                                  install everything, with the package manager
                                  package.json's packageManager names (else the
                                  lockfile's), from the workspace root. --frozen
                                  installs exactly what the lockfile pins and fails
                                  rather than rewrite it (a missing lockfile is
                                  generated); --if-changed does nothing when
                                  node_modules already matches the lockfile;
                                  --print-watched installs nothing and prints the
                                  files whose change means installing again;
                                  --nix builds node_modules in the Nix store from
                                  the lockfile alone (any manager's) and copies it
                                  in - same lockfile, same store path
  pkgi add <pkg>[@version]... [--dev]
  pkgi remove <pkg>...
  pkgi compare [path...] [--different] [--json]
                                  this folder's packages beside other folders'; without
                                  paths, the ones last ticked in the dashboard
  pkgi note <pkg> [text...]       show, set (or with --clear, delete) a note on a package
  pkgi notes                      every note in this folder
  pkgi config [--init]            where settings and notes live; --init writes a
                                  commented pkgi.config.ts here

Add --dry-run to install/update/add/remove to print the command instead of running it.
`;

const UPDATE_MARK: Record<string, string> = {
  major: 'MAJOR',
  minor: 'minor',
  patch: 'patch',
  prerelease: 'pre',
  none: '',
};

const SHORT_TYPE: Record<DependencyType, string> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
  optionalDependencies: 'opt',
};

const table = (header: string[], rows: string[][]) => {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => cell.padEnd((widths[column] ?? 0) + 2))
      .join('')
      .trimEnd();
  console.log(line(header));
  for (const row of rows) console.log(line(row));
};

/** Run a package-manager command in the folder, its output straight to the terminal. */
const runCommand = async (dir: string, argv: string[], dryRun: boolean) => {
  console.log(`$ ${shellQuote(argv)}`);
  if (dryRun) return;
  const result = await exec(argv, { cwd: dir, stream: true });
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
};

/**
 * `pkgi install --nix`: node_modules as a Nix build of the lockfile (see core/nix and dev-tools'
 * nix/lib/node-modules.nix). Keyed by the lockfile's hash alone — whether `bun add`, a pull or a
 * checkout wrote it doesn't matter. Without a lockfile yet, the manager writes one first.
 */
const installThroughNix = async (
  root: string,
  manager: Awaited<ReturnType<typeof detectPackageManager>>,
  found: string | undefined,
  ifChanged: boolean,
  dryRun: boolean,
) => {
  let lockfile = found;
  if (!lockfile) {
    console.log(`No ${manager.name} lockfile in ${root} yet — writing one.`);
    await runCommand(root, lockfileOnlyCommand(manager.name), dryRun);
    lockfile = findLockfile(root, manager.name);
    if (dryRun) return;
    if (!lockfile) {
      console.error(`pkgi: ${manager.name} wrote no lockfile in ${root}`);
      process.exitCode = 1;
      return;
    }
  }
  if (ifChanged && (await isInstallCurrent(root, manager.name, lockfile, { fromNix: true })))
    return;
  const mismatch = await managerVersionMismatch(manager.name, manager.version);
  if (mismatch) {
    console.error(
      `pkgi: package.json pins ${manager.name}@${manager.version}, but ${manager.name} on PATH is ${mismatch} — the build uses the one on PATH`,
    );
  }
  const key = (await hashFile(lockfile)).slice(0, 32);
  try {
    const manifest = await buildManifest(root, manager.name, lockfile, manager.version);
    console.log(
      `pkgi: node_modules for ${basename(lockfile)} ${key.slice(0, 12)} — ${manifest.tarballs.length} packages, built by Nix`,
    );
    if (dryRun) return;
    const out = await buildNodeModules(root, manifest, key);
    await placeNodeModules(root, out, manifest.workspaces);
    await writeInstallStamp(root, manager.name, lockfile, out);
    await pruneBuilds(root);
    console.log(`pkgi: node_modules ← ${out}`);
    for (const dir of manifest.workspaces) {
      const at = join(root, dir);
      const scripts =
        ((await Bun.file(join(at, 'package.json')).json()) as { scripts?: Record<string, string> })
          .scripts ?? {};
      for (const name of OWN_LIFECYCLE) {
        if (scripts[name]) await runCommand(at, [manager.name, 'run', name], false);
      }
    }
  } catch (error) {
    console.error(`pkgi: ${(error as Error).message}`);
    process.exitCode = 1;
  }
};

/** `name@1.2.3` → ['name', '1.2.3']; `@scope/name` keeps its leading `@`. */
const splitSpec = (spec: string): [string, string | undefined] => {
  const at = spec.lastIndexOf('@');
  return at > 0 ? [spec.slice(0, at), spec.slice(at + 1) || undefined] : [spec, undefined];
};

/**
 * `pkgi [tab | list | outdated | update | add | remove | compare | note | notes | config]`.
 *
 * Everything works on the current directory: no repository layout, no registry of projects. The
 * dashboard is imported lazily, as giti and agenti do, so the scripted commands never load Ink.
 */
export const run = async (...argv: string[]) => {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));
  const dir = process.cwd();
  const dryRun = flags.has('--dry-run');

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const context = await loadFolderContext(dir);
  const { settings, state } = context;
  if (context.project.error) {
    console.error(`pkgi: ignoring ${context.project.path}: ${context.project.error}`);
  }

  if (first === 'list' || first === 'ls' || first === 'outdated') {
    const manifest = await readManifest(dir, settings.dependencyTypes);
    if (!manifest.exists) {
      console.error(`No package.json in ${dir}`);
      process.exitCode = 1;
      return;
    }
    const infos = flags.has('--offline') ? {} : await fetchInfos(manifest, settings);
    let rows = buildRows(manifest, infos, state.notes, settings);
    const onlyOutdated = first === 'outdated' || flags.has('--outdated');
    if (onlyOutdated) rows = rows.filter(isOutdated);
    if (flags.has('--json'))
      console.log(
        JSON.stringify(
          rows.map(({ info: _info, ...row }) => row),
          null,
          2,
        ),
      );
    else if (!rows.length)
      console.log(onlyOutdated ? 'Everything is up to date.' : 'No dependencies.');
    else
      table(
        ['PACKAGE', 'TYPE', 'DECLARED', 'INSTALLED', 'LATEST', 'UPDATE', 'NOTE'],
        rows.map((row) => [
          row.name,
          SHORT_TYPE[row.type],
          row.range,
          row.installed ?? '—',
          row.info?.error === 'not-found' ? '(not on registry)' : (row.latest ?? ''),
          [
            UPDATE_MARK[row.update],
            row.prerelease ? `${row.prereleaseTag}: ${row.prerelease}` : '',
            row.deprecated ? 'DEPRECATED' : '',
          ]
            .filter(Boolean)
            .join(' '),
          row.note ?? '',
        ]),
      );
    if (first === 'outdated' && rows.length) process.exitCode = 1;
    return;
  }

  if (first === 'update' || first === 'upgrade') {
    if (!rest.length) {
      console.error('usage: pkgi update <pkg>[@version]...');
      process.exitCode = 1;
      return;
    }
    const manifest = await readManifest(dir);
    const manager = await detectPackageManager(dir, settings.packageManager);
    const infos = await fetchInfos(manifest, settings);
    for (const spec of rest) {
      const [name, wanted] = splitSpec(spec);
      const dep = manifest.dependencies.find((candidate) => candidate.name === name);
      if (!dep) {
        console.error(`${name} is not a dependency here — use pkgi add`);
        process.exitCode = 1;
        continue;
      }
      const version = wanted ?? infos[name]?.latest;
      if (!version) {
        console.error(`${name}: no version on the registry to update to`);
        process.exitCode = 1;
        continue;
      }
      await runCommand(
        dir,
        setVersionCommand(manager.name, name, version, dep.type, dep.range),
        dryRun,
      );
    }
    return;
  }

  if (first === 'install' && !rest.length) {
    const manager = await detectPackageManager(dir, settings.packageManager);
    const root = manager.root ?? dir;
    const lockfile = findLockfile(root, manager.name);
    if (flags.has('--print-watched')) {
      for (const path of [stampPath(root), ...(lockfile ? [lockfile] : [])]) console.log(path);
      return;
    }
    if (flags.has('--nix')) {
      await installThroughNix(root, manager, lockfile, flags.has('--if-changed'), dryRun);
      return;
    }
    if (flags.has('--if-changed') && (await isInstallCurrent(root, manager.name, lockfile))) return;
    const frozen = flags.has('--frozen') && lockfile !== undefined;
    if (flags.has('--frozen') && !frozen) {
      console.log(`No ${manager.name} lockfile in ${root} yet — installing to generate one.`);
    }
    const mismatch = dryRun
      ? undefined
      : await managerVersionMismatch(manager.name, manager.version);
    if (mismatch) {
      console.error(
        `pkgi: package.json pins ${manager.name}@${manager.version}, but ${manager.name} on PATH is ${mismatch} — the install may differ from one made with the pinned version`,
      );
    }
    const argv = installCommand(manager.name, { frozen, version: manager.version, dir: root });
    await runCommand(root, argv, dryRun);
    const written = findLockfile(root, manager.name);
    if (!dryRun && !process.exitCode && written)
      await writeInstallStamp(root, manager.name, written);
    return;
  }

  if (first === 'add' || first === 'install') {
    if (!rest.length) {
      console.error('usage: pkgi add <pkg>[@version]... [--dev]');
      process.exitCode = 1;
      return;
    }
    const manager = await detectPackageManager(dir, settings.packageManager);
    const dev = flags.has('--dev') || (settings.installAs === 'dev' && !flags.has('--prod'));
    for (const spec of rest) {
      const [name, version] = splitSpec(spec);
      await runCommand(
        dir,
        addCommand(manager.name, name, version, dev ? 'devDependencies' : 'dependencies'),
        dryRun,
      );
    }
    return;
  }

  if (first === 'remove' || first === 'rm' || first === 'uninstall') {
    if (!rest.length) {
      console.error('usage: pkgi remove <pkg>...');
      process.exitCode = 1;
      return;
    }
    const manager = await detectPackageManager(dir, settings.packageManager);
    await runCommand(dir, removeCommand(manager.name, rest), dryRun);
    return;
  }

  if (first === 'compare') {
    const paths = rest.length ? rest : state.compareSelection;
    if (!paths.length) {
      console.error(
        "usage: pkgi compare <path...> — or tick folders on the dashboard's Compare tab",
      );
      process.exitCode = 1;
      return;
    }
    const columns = await loadColumns(dir, [dir, ...paths.map((path) => toAbsolute(dir, path))]);
    let rows = buildComparison(columns);
    if (flags.has('--different')) rows = rows.filter((row) => row.differs);
    if (flags.has('--json')) {
      console.log(
        JSON.stringify(
          rows.map((row) => ({
            name: row.name,
            differs: row.differs,
            versions: Object.fromEntries(
              columns.map((column, at) => [column.label, cellVersion(row.cells[at]) ?? null]),
            ),
          })),
          null,
          2,
        ),
      );
      return;
    }
    table(
      ['PACKAGE', ...columns.map((column) => column.label), ''],
      rows.map((row) => [
        row.name,
        ...row.cells.map((cell) => cellVersion(cell) ?? '—'),
        row.differs ? '≠' : '',
      ]),
    );
    return;
  }

  if (first === 'note') {
    const [name, ...words] = rest;
    if (!name) {
      console.error('usage: pkgi note <pkg> [text...] [--clear]');
      process.exitCode = 1;
      return;
    }
    if (flags.has('--clear')) {
      delete state.notes[name];
      await writeFolderState(context.statePath, state);
      console.log(`Cleared the note on ${name}`);
      return;
    }
    if (!words.length) {
      console.log(state.notes[name]?.note ?? `No note on ${name}`);
      return;
    }
    state.notes[name] = { note: words.join(' '), updatedAt: new Date().toISOString() };
    await writeFolderState(context.statePath, state);
    console.log(`Noted on ${name} — ${context.statePath}`);
    return;
  }

  if (first === 'notes') {
    const entries = Object.entries(state.notes);
    if (!entries.length) console.log('No notes in this folder.');
    else
      table(
        ['PACKAGE', 'NOTE'],
        entries.map(([name, { note }]) => [name, note]),
      );
    return;
  }

  if (first === 'config') {
    if (flags.has('--init')) {
      const target = join(dir, 'pkgi.config.ts');
      if (existsSync(target)) {
        console.error(`${target} already exists`);
        process.exitCode = 1;
        return;
      }
      await writeFile(target, PROJECT_CONFIG_TEMPLATE);
      console.log(`Wrote ${target}`);
      return;
    }
    const manager = await detectPackageManager(dir, settings.packageManager);
    console.log(`folder          ${dir}`);
    console.log(
      `pkgi.config     ${context.project.path ?? '(none — pkgi config --init writes one)'}`,
    );
    console.log(
      `state (notes)   ${context.statePath}${existsSync(context.statePath) ? '' : ' (not written yet)'}`,
    );
    console.log(`package manager ${manager.name} — ${manager.reason}`);
    console.log(`settings        ${JSON.stringify(settings)}`);
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    console.error(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    process.exitCode = 1;
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(dir, first as TabId | undefined);
  process.exit(0);
};

export default run;
