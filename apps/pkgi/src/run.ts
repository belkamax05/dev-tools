import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import {
  type DependencyType,
  type FolderSettings,
  loadFolderContext,
  type PackageNote,
  PROJECT_CONFIG_TEMPLATE,
  TAB_IDS,
  type TabId,
  writeFolderState,
} from './config/settings';
import { buildComparison, cellVersion, loadColumns, toAbsolute } from './core/compare';
import type { SupportInfo } from './core/eol';
import {
  hashFile,
  isInstallCurrent,
  managerVersionMismatch,
  stampPath,
  writeInstallStamp,
} from './core/install';
import {
  addCommand,
  auditCommand,
  clearCacheCommand,
  detectPackageManager,
  findLockfile,
  installCommand,
  lockfileOnlyCommand,
  readManifest,
  removeCommand,
  runScriptCommand,
  setVersionCommand,
  shellQuote,
} from './core/manifest';
import {
  buildManifest,
  buildNodeModules,
  clearFailures,
  failedBefore,
  type NixManifest,
  OWN_LIFECYCLE,
  placeNodeModules,
  prefetchAuthenticated,
  pruneBuilds,
  recordFailure,
} from './core/nix';
import { readNpmrcAuth } from './core/npmrc';
import { buildRows, fetchInfos, isOutdated } from './core/packages';
import { getManyPackageInfo } from './core/registry';
import {
  getManyPackageSupport,
  isUnsupported,
  supportLabel,
} from './core/support';
import {
  buildReport,
  entryStatus,
  folderLabels,
  locationCell,
  readPreviousPackages,
  renderMarkdown,
  versionsInUse,
} from './core/report';

const HELP = `pkgi — the packages of the folder you are in: installed, latest, notes, compare

usage:
  pkgi                            open the dashboard
  pkgi <tab>                      open it on a tab: ${TAB_IDS.join(', ')}
  pkgi list [--outdated] [--eol] [--offline] [--json] [--verbose]
                                  every dependency: declared, installed, latest, support
                                  (endoflife.date's window, else "stale" when the
                                  registry shows no release in 2 years, or the line in
                                  use none in a year while 2+ majors behind)
  pkgi outdated [--json]          the ones with a newer version; exits 1 when there are any
  pkgi eol [--json] [--verbose]   the ones past their end of life, ending within 90 days,
                                  stale or deprecated; exits 1 when there are any
  pkgi update <pkg>[@version]...  move packages to a version (latest by default), keeping
                                  their section and range style (^, ~, exact)
  pkgi update                     every package behind by a minor or patch (majors are
                                  left to you, one at a time)
  pkgi install [--frozen | --nix] [--if-changed] [--print-watched] [--silent]
                                  install everything, with the package manager
                                  package.json's packageManager names (else the
                                  lockfile's), from the workspace root. --frozen
                                  installs exactly what the lockfile pins and fails
                                  rather than rewrite it (a missing lockfile is
                                  generated); --if-changed does nothing when
                                  node_modules already matches the lockfile (with
                                  --nix, also when the last build of it failed and
                                  nothing it depends on changed);
                                  --print-watched installs nothing and prints the
                                  files whose change means installing again;
                                  --nix builds node_modules in the Nix store from
                                  the lockfile alone (any manager's) and copies it
                                  in - same lockfile, same store path; --silent
                                  prints nothing unless it fails
  pkgi add <pkg>[@version]... [--dev]
                                  without names: the dashboard's Add tab (registry search)
  pkgi remove <pkg>...            without names: tick them from a list
  pkgi run <script> [args...]     a package.json script, with the folder's package manager
  pkgi run                        without a script: the Scripts tab, to pick one
  pkgi start [args...]            pkgi run start
  pkgi audit                      the package manager's security audit
  pkgi clear-cache                empty the package manager's download cache
  pkgi clear-modules              delete this folder's node_modules
  pkgi report [path...] [--offline] [--json] [--no-write]
                                  every package of several folders in one table: versions
                                  in each, latest, deprecation, end of life, notes. Without
                                  paths, pkgi.config.ts's reportPaths (else this folder).
                                  With reportDir set there, writes
                                  dependencies-report.json and .md into it, keeping when
                                  each package was first seen and when it was dropped
  pkgi compare [path...] [--different] [--json]
                                  this folder's packages beside other folders'; without
                                  paths, the ones last ticked in the dashboard
  pkgi note <pkg> [text...]       show, set (or with --clear, delete) a note on a package
  pkgi notes                      every note in this folder
  pkgi config [--init]            where settings and notes live; --init writes a
                                  commented pkgi.config.ts here

Add --dry-run to install/update/add/remove/audit/clear-cache/clear-modules to print the
command instead of running it.
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

/**
 * Run a package-manager command in the folder, its output straight to the terminal — or, `quiet`,
 * captured and shown only when it fails.
 */
const runCommand = async (dir: string, argv: string[], dryRun: boolean, quiet = false) => {
  if (!quiet || dryRun) console.log(`$ ${shellQuote(argv)}`);
  if (dryRun) return;
  const result = await exec(argv, { cwd: dir, stream: !quiet });
  if (result.exitCode === 0) return;
  process.exitCode = result.exitCode;
  if (quiet) {
    console.error(`$ ${shellQuote(argv)}`);
    for (const output of [result.stdout, result.stderr]) if (output) console.error(output);
  }
};

/**
 * Run a command that may want the keyboard — a dev server, a watcher, an interactive audit fix —
 * with this process's stdin, which {@link exec} never hands over.
 */
const runInteractive = async (dir: string, argv: string[]) => {
  console.log(`$ ${shellQuote(argv)}`);
  try {
    const child = Bun.spawn(argv, {
      cwd: dir,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const code = await child.exited;
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    console.error(`pkgi: ${(error as Error).message}`);
    process.exitCode = 127;
  }
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
  const auths = await readNpmrcAuth(root);
  let manifest: NixManifest | undefined;
  try {
    manifest = await buildManifest(root, manager.name, lockfile, manager.version);
    if (ifChanged && (await failedBefore(root, manifest, auths))) {
      console.error(
        `pkgi: the last Nix build for ${basename(lockfile)} ${key.slice(0, 12)} failed, and nothing it depends on has changed since — not retrying on its own; run \`pkgi install --nix\` to try again`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `pkgi: node_modules for ${basename(lockfile)} ${key.slice(0, 12)} — ${manifest.tarballs.length} packages, built by Nix`,
    );
    if (dryRun) return;
    const out = await buildNodeModules(
      root,
      await prefetchAuthenticated(root, manifest, auths),
      key,
    );
    await placeNodeModules(root, out, manifest.workspaces);
    await writeInstallStamp(root, manager.name, lockfile, out);
    await clearFailures(root);
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
    const message = (error as Error).message;
    console.error(`pkgi: ${message}`);
    if (manifest && !dryRun) await recordFailure(root, manifest, auths, message);
    process.exitCode = 1;
  }
};

/**
 * `pkgi report`: read every folder, ask the registry and endoflife.date about each package once,
 * print the table, and — with a `reportDir` — write the JSON and Markdown, carrying the history
 * over from the JSON already there.
 */
const report = async (
  dir: string,
  paths: string[],
  options: {
    notes: Record<string, PackageNote>;
    settings: FolderSettings;
    reportDir?: string;
    offline: boolean;
    json: boolean;
    write: boolean;
  },
) => {
  const missing = paths.filter((path) => !existsSync(join(toAbsolute(dir, path), 'package.json')));
  for (const path of missing) console.error(`pkgi: no package.json in ${path} — left out`);
  const present = paths.filter((path) => !missing.includes(path));
  const labels = folderLabels(present);
  const columns = (await loadColumns(dir, present.map((path) => toAbsolute(dir, path)))).map(
    (column, at) => ({ ...column, label: labels[at] ?? column.label }),
  );

  const names = [
    ...new Set(
      columns.flatMap((column) =>
        column.manifest.dependencies.filter((dep) => !dep.local).map((dep) => dep.name),
      ),
    ),
  ];
  const { settings } = options;
  const infos = options.offline
    ? {}
    : await getManyPackageInfo(names, {
        registry: settings.registry,
        maxAgeMs: settings.cacheHours * 3600_000,
      });

  //? Judged on the oldest version in use — the one that runs out first
  const support: Record<string, SupportInfo | undefined> = options.offline
    ? {}
    : await getManyPackageSupport(
        names.map((name) => ({
          name,
          info: infos[name],
          current:
            versionsInUse(
              columns.flatMap((column) =>
                column.manifest.dependencies
                  .filter((dep) => dep.name === name)
                  .map((dep) => ({ folder: column.label, ...dep })),
              ),
            )[0] ?? '',
        })),
        { registry: settings.registry },
      );

  const out = options.reportDir ? resolve(dir, options.reportDir) : undefined;
  const jsonPath = out && join(out, 'dependencies-report.json');
  let previous = {};
  if (jsonPath && existsSync(jsonPath)) {
    try {
      previous = readPreviousPackages(await Bun.file(jsonPath).json());
    } catch {}
  }
  const result = buildReport({
    columns,
    paths: present,
    infos,
    support,
    notes: options.notes,
    previous,
    now: new Date().toISOString(),
  });

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    table(
      ['PACKAGE', ...labels, 'LATEST', 'STATUS'],
      Object.values(result.packages).map((entry) => [
        entry.name,
        ...labels.map((label) =>
          locationCell(entry.locations.find((location) => location.folder === label)),
        ),
        entry.latest ?? '',
        entryStatus(entry),
      ]),
    );
  }

  if (!out || !jsonPath || !options.write) return;
  await mkdir(out, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(out, 'dependencies-report.md'), renderMarkdown(result));
  //? To stderr, so `pkgi report --json > file` stays valid JSON
  console.error(`\npkgi: wrote ${jsonPath} and dependencies-report.md`);
};

/** `name@1.2.3` → ['name', '1.2.3']; `@scope/name` keeps its leading `@`. */
const splitSpec = (spec: string): [string, string | undefined] => {
  const at = spec.lastIndexOf('@');
  return at > 0 ? [spec.slice(0, at), spec.slice(at + 1) || undefined] : [spec, undefined];
};

/**
 * `pkgi [tab | list | outdated | update | install | add | remove | run | start | audit |
 * clear-cache | clear-modules | compare | report | note | notes | config]`.
 *
 * Everything works on the current directory: no repository layout, no registry of projects. The
 * dashboard is imported lazily, as giti and agenti do, so the scripted commands never load Ink.
 */
export const run = async (...argv: string[]) => {
  //? Before any flag parsing: everything after the script name is the script's own, `--help`
  //? and `--watch` included
  if (argv[0] === 'run' || argv[0] === 'start') {
    const [command, ...tail] = argv;
    const [script, ...args] = command === 'start' ? ['start', ...tail] : tail;
    const dir = process.cwd();
    if (!script) {
      const { default: renderDashboard } = await import('./ui/renderDashboard');
      await renderDashboard(dir, 'scripts');
      process.exit(0);
    }
    const { settings } = await loadFolderContext(dir);
    const manager = await detectPackageManager(dir, settings.packageManager);
    await runInteractive(dir, runScriptCommand(manager.name, script, args));
    return;
  }

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

  if (first === 'list' || first === 'ls' || first === 'outdated' || first === 'eol') {
    const manifest = await readManifest(dir, settings.dependencyTypes);
    if (!manifest.exists) {
      console.error(`No package.json in ${dir}`);
      process.exitCode = 1;
      return;
    }
    const offline = flags.has('--offline');
    const infos = offline ? {} : await fetchInfos(manifest, settings);
    let rows = buildRows(manifest, infos, state.notes, settings);
    const support = offline
      ? {}
      : await getManyPackageSupport(
          rows.filter((row) => !row.local),
          { registry: settings.registry },
        );
    const onlyOutdated = first === 'outdated' || flags.has('--outdated');
    const onlyUnsupported = first === 'eol' || flags.has('--eol');
    if (onlyOutdated) rows = rows.filter(isOutdated);
    if (onlyUnsupported)
      rows = rows.filter((row) => isUnsupported(support[row.name]) || row.deprecated);
    if (flags.has('--json'))
      console.log(
        JSON.stringify(
          rows.map(({ info: _info, ...row }) => ({ ...row, support: support[row.name] })),
          null,
          2,
        ),
      );
    else if (!rows.length)
      console.log(
        onlyUnsupported
          ? 'Nothing past its end of life, ending soon, stale or deprecated.'
          : onlyOutdated
            ? 'Everything is up to date.'
            : 'No dependencies.',
      );
    else
      table(
        ['PACKAGE', 'TYPE', 'DECLARED', 'INSTALLED', 'LATEST', 'UPDATE', 'SUPPORT', 'NOTE'],
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
          support[row.name]
            ? `${supportLabel(support[row.name])}${flags.has('--verbose') ? ` (${support[row.name]?.summary})` : ''}`
            : '',
          row.note ?? '',
        ]),
      );
    if ((first === 'outdated' || first === 'eol') && rows.length) process.exitCode = 1;
    return;
  }

  if (first === 'update' || first === 'upgrade') {
    const manifest = await readManifest(dir);
    const manager = await detectPackageManager(dir, settings.packageManager);
    const infos = await fetchInfos(manifest, settings);
    if (!rest.length) {
      //? The dashboard's [A]: majors are each a migration to read the notes for, not a bulk step
      const safe = buildRows(manifest, infos, state.notes, settings).filter(
        (row) => !row.local && row.latest && (row.update === 'minor' || row.update === 'patch'),
      );
      if (!safe.length) console.log('Nothing behind by only a minor or patch.');
      for (const row of safe) {
        await runCommand(
          dir,
          setVersionCommand(manager.name, row.name, row.latest as string, row.type, row.range),
          dryRun,
        );
      }
      const majors = buildRows(manifest, infos, state.notes, settings).filter(
        (row) => !row.local && row.update === 'major',
      );
      if (majors.length) {
        console.log(
          `\nLeft behind by a major (pkgi update <pkg> for each): ${majors
            .map((row) => `${row.name} ${row.current} → ${row.latest}`)
            .join(', ')}`,
        );
      }
      return;
    }
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
    if (flags.has('--frozen') && !frozen && !flags.has('--silent')) {
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
    await runCommand(root, argv, dryRun, flags.has('--silent'));
    const written = findLockfile(root, manager.name);
    if (!dryRun && !process.exitCode && written)
      await writeInstallStamp(root, manager.name, written);
    return;
  }

  if (first === 'add' || first === 'install') {
    if (!rest.length) {
      const { default: renderDashboard } = await import('./ui/renderDashboard');
      await renderDashboard(dir, 'add');
      process.exit(0);
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
    let names = rest;
    if (!names.length) {
      const manifest = await readManifest(dir);
      const declared = [...new Set(manifest.dependencies.map((dep) => dep.name))].sort();
      if (!declared.length) {
        console.error(`No dependencies in ${dir}`);
        process.exitCode = 1;
        return;
      }
      const { default: pickPackages } = await import('./ui/pickPackages');
      names = await pickPackages('Remove which packages?', declared);
      if (!names.length) return;
    }
    const manager = await detectPackageManager(dir, settings.packageManager);
    await runCommand(dir, removeCommand(manager.name, names), dryRun);
    return;
  }

  if (first === 'audit' || first === 'clear-cache') {
    const manager = await detectPackageManager(dir, settings.packageManager);
    const audit = auditCommand(manager.name, { version: manager.version, dir: manager.root });
    if (first === 'clear-cache') await runCommand(dir, clearCacheCommand(manager.name), dryRun);
    else if (dryRun) console.log(`$ ${shellQuote(audit)}`);
    //? Its exit code is non-zero when anything is found — passed on, for CI
    else await runInteractive(dir, audit);
    return;
  }

  if (first === 'clear-modules') {
    const target = join(dir, 'node_modules');
    if (!existsSync(target)) {
      console.log(`No node_modules in ${dir}`);
      return;
    }
    console.log(`$ rm -rf ${shellQuote([target])}`);
    if (!dryRun) await rm(target, { recursive: true, force: true });
    return;
  }

  if (first === 'report') {
    await report(dir, rest.length ? rest : (context.project.config.reportPaths ?? ['.']), {
      notes: state.notes,
      settings,
      reportDir: context.project.config.reportDir,
      offline: flags.has('--offline'),
      json: flags.has('--json'),
      write: !flags.has('--no-write'),
    });
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
