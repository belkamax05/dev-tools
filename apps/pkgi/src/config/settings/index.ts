import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { defaultFolderStateFile } from '../paths';

/** The dashboard's tabs, in order. */
export const TAB_IDS = ['packages', 'compare', 'add', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const DEPENDENCY_TYPES = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const PACKAGE_MANAGERS = ['bun', 'npm', 'yarn', 'pnpm'] as const;
export type PackageManagerName = (typeof PACKAGE_MANAGERS)[number];

/**
 * The settings that decide what pkgi shows in a folder. Each can come from three places, later
 * winning: pkgi's defaults, the folder's `pkgi.config.ts`, and what was toggled in the dashboard
 * (kept in the folder's state file).
 */
export interface FolderSettings {
  /** Offer prereleases (`next`, `beta`, `canary`…) in update hints and the version picker. */
  showUnstable: boolean;
  /** Which sections of `package.json` are listed. */
  dependencyTypes: DependencyType[];
  /** Where a newly added package goes. */
  installAs: 'prod' | 'dev';
  /** How long a registry answer is reused before it is asked again. */
  cacheHours: number;
  /** The npm registry to ask — a mirror or a private registry. */
  registry: string;
  /** Use this package manager rather than the one the lockfile suggests. */
  packageManager?: PackageManagerName;
}

/**
 * What a folder's `pkgi.config.ts` may export — every key optional, and the file itself too.
 *
 * ```ts
 * // pkgi.config.ts
 * export default {
 *   stateFile: '.pkgi/state.json',     // keep notes in the repo, to share them
 *   comparePaths: ['../web', '../api'],
 *   reportPaths: ['../web', '../api'],
 *   reportDir: 'reports',
 *   showUnstable: false,
 *   dependencyTypes: ['dependencies', 'devDependencies'],
 * };
 * ```
 */
export interface PkgiProjectConfig extends Partial<FolderSettings> {
  /**
   * Where this folder's state (notes, compare folders, dashboard toggles) is kept. Relative to the
   * folder. Defaults to a per-folder file in pkgi's state directory, outside the repository.
   */
  stateFile?: string;
  /** Folders offered for comparison, relative to this one or absolute. */
  comparePaths?: string[];
  /** Folders `pkgi report` covers when none are given, relative to this one or absolute. */
  reportPaths?: string[];
  /**
   * Where `pkgi report` writes `dependencies-report.json` and `.md`, relative to this folder.
   * Left out, the report is only printed.
   */
  reportDir?: string;
}

export const DEFAULT_SETTINGS: FolderSettings = {
  showUnstable: false,
  dependencyTypes: ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'],
  installAs: 'prod',
  cacheHours: 4,
  registry: 'https://registry.npmjs.org',
};

/** The file names looked for, in order. `.ts` is the documented one; the rest are for projects without TS. */
export const PROJECT_CONFIG_NAMES = [
  'pkgi.config.ts',
  'pkgi.config.mjs',
  'pkgi.config.js',
] as const;

/** Keep what is well-formed in a partial settings object, drop the rest. */
const coerceSettings = (raw: Record<string, unknown>): Partial<FolderSettings> => {
  const out: Partial<FolderSettings> = {};
  if (typeof raw.showUnstable === 'boolean') out.showUnstable = raw.showUnstable;
  if (Array.isArray(raw.dependencyTypes)) {
    const types = raw.dependencyTypes.filter((type): type is DependencyType =>
      DEPENDENCY_TYPES.includes(type as DependencyType),
    );
    if (types.length) out.dependencyTypes = types;
  }
  if (raw.installAs === 'prod' || raw.installAs === 'dev') out.installAs = raw.installAs;
  if (typeof raw.cacheHours === 'number' && raw.cacheHours >= 0) out.cacheHours = raw.cacheHours;
  if (typeof raw.registry === 'string' && /^https?:\/\//.test(raw.registry)) {
    out.registry = raw.registry.replace(/\/+$/, '');
  }
  if (PACKAGE_MANAGERS.includes(raw.packageManager as PackageManagerName)) {
    out.packageManager = raw.packageManager as PackageManagerName;
  }
  return out;
};

const pathList = (value: unknown[]): string[] =>
  value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));

export interface ProjectConfigResult {
  config: PkgiProjectConfig;
  /** The file it came from, when there is one. */
  path?: string;
  /** Why the file could not be used — shown in the dashboard rather than thrown. */
  error?: string;
}

/**
 * Load the folder's `pkgi.config.ts`, if it has one.
 *
 * Imported, not parsed: the file is code, so a project can compute a value (a path from an env
 * var, say). Bun runs TypeScript directly, which is why `.ts` is the documented form. A file that
 * throws or exports nothing usable costs its settings, not the run.
 */
export const loadProjectConfig = async (dir: string): Promise<ProjectConfigResult> => {
  const name = PROJECT_CONFIG_NAMES.find((candidate) => existsSync(join(dir, candidate)));
  if (!name) return { config: {} };
  const path = join(dir, name);
  try {
    //? The query string defeats the module cache, so a config edited while the dashboard is open
    //? is read fresh after the editor closes
    const module = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
    const raw = (module.default ?? module.config ?? module) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return { config: {}, path, error: 'exports no object' };
    const config: PkgiProjectConfig = coerceSettings(raw);
    if (typeof raw.stateFile === 'string' && raw.stateFile.trim()) config.stateFile = raw.stateFile;
    if (Array.isArray(raw.comparePaths)) config.comparePaths = pathList(raw.comparePaths);
    if (Array.isArray(raw.reportPaths)) config.reportPaths = pathList(raw.reportPaths);
    if (typeof raw.reportDir === 'string' && raw.reportDir.trim()) config.reportDir = raw.reportDir;
    return { config, path };
  } catch (error) {
    return { config: {}, path, error: (error as Error).message };
  }
};

/** A starting `pkgi.config.ts` — every key, commented, with its default. */
export const PROJECT_CONFIG_TEMPLATE = `/**
 * pkgi settings for this folder. Every key is optional; delete what you do not need.
 * Values toggled in the pkgi dashboard override these for you alone (they are kept in the
 * state file below), so this file is the team's defaults.
 */
export default {
  /**
   * Where notes, compare folders and dashboard toggles are kept. Relative to this folder.
   * Left out, they live in pkgi's own state directory (~/.local/state/pkgi/folders/) and
   * this repository is never written to. Point it inside the repo to share notes via git.
   */
  // stateFile: '.pkgi/state.json',

  /** Folders offered on the Compare tab, relative to this one. */
  comparePaths: [],

  /** Folders \`pkgi report\` covers when none are given, relative to this one. */
  // reportPaths: ['.'],

  /** Where \`pkgi report\` writes dependencies-report.json and .md. Left out, it only prints. */
  // reportDir: 'reports',

  /** Offer prereleases (next / beta / canary) as updates. */
  showUnstable: ${DEFAULT_SETTINGS.showUnstable},

  /** Sections of package.json to list. */
  dependencyTypes: ${JSON.stringify(DEFAULT_SETTINGS.dependencyTypes)},

  /** Where a newly added package goes: 'prod' or 'dev'. */
  installAs: '${DEFAULT_SETTINGS.installAs}',

  /** Hours a registry answer is reused before it is asked again. */
  cacheHours: ${DEFAULT_SETTINGS.cacheHours},

  /** A registry mirror or private registry. */
  registry: '${DEFAULT_SETTINGS.registry}',

  /** Force a package manager instead of detecting it from the lockfile: 'bun' | 'npm' | 'yarn' | 'pnpm'. */
  // packageManager: 'bun',
};
`;

export interface PackageNote {
  note: string;
  updatedAt: string;
}

/**
 * One folder's state: what the user has recorded about this folder's packages and chosen for it.
 *
 * Notes are why this is per folder and not per user: "pinned until the SSR bug is fixed" is about
 * *this* project's `react`, and a note on every `react` everywhere would be wrong in the others.
 */
export interface FolderState {
  version: 1;
  /** The folder it is about — so a file in the shared state directory can be told apart. */
  dir: string;
  notes: Record<string, PackageNote>;
  /** Folders added from the dashboard (the config file's own are not repeated here). */
  comparePaths: string[];
  /** Which of the offered folders were last ticked for comparison. */
  compareSelection: string[];
  /** Settings toggled in the dashboard for this folder. */
  settings: Partial<FolderSettings>;
}

const emptyState = (dir: string): FolderState => ({
  version: 1,
  dir,
  notes: {},
  comparePaths: [],
  compareSelection: [],
  settings: {},
});

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** Resolve where a folder's state lives: the config's `stateFile`, or the default. */
export const folderStatePath = (dir: string, config: PkgiProjectConfig): string =>
  config.stateFile
    ? isAbsolute(config.stateFile)
      ? config.stateFile
      : resolve(dir, config.stateFile)
    : defaultFolderStateFile(dir);

export const readFolderState = async (path: string, dir: string): Promise<FolderState> => {
  try {
    const raw = JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
    const notes: Record<string, PackageNote> = {};
    if (raw.notes && typeof raw.notes === 'object') {
      for (const [name, value] of Object.entries(raw.notes as Record<string, unknown>)) {
        //? A bare string is accepted — the shortest way to write a note by hand
        if (typeof value === 'string' && value.trim()) notes[name] = { note: value, updatedAt: '' };
        else if (value && typeof (value as PackageNote).note === 'string') {
          const entry = value as PackageNote;
          notes[name] = { note: entry.note, updatedAt: String(entry.updatedAt ?? '') };
        }
      }
    }
    return {
      version: 1,
      dir,
      notes,
      comparePaths: stringList(raw.comparePaths),
      compareSelection: stringList(raw.compareSelection),
      settings: coerceSettings((raw.settings as Record<string, unknown>) ?? {}),
    };
  } catch {
    return emptyState(dir);
  }
};

/**
 * Write a folder's state — through a temporary file and a rename, so a crash mid-write cannot
 * leave the notes half-written. The directory is created on the first write only: a folder whose
 * state was never changed never gets a file.
 */
export const writeFolderState = async (path: string, state: FolderState): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, path);
};

/** The settings in force: defaults, then the config file, then the folder's own toggles. */
export const resolveSettings = (config: PkgiProjectConfig, state: FolderState): FolderSettings => {
  const {
    stateFile: _stateFile,
    comparePaths: _comparePaths,
    reportPaths: _reportPaths,
    reportDir: _reportDir,
    ...fromConfig
  } = config;
  return { ...DEFAULT_SETTINGS, ...fromConfig, ...state.settings };
};

/**
 * `~/.config/pkgi/config.json`: the one setting that is the person's everywhere — the theme.
 * Everything that depends on the project is per folder instead.
 */
export const userConfigStore = createConfigStore({
  appName: 'pkgi',
  defaults: { theme: 'classic' },
});

/** `~/.local/state/pkgi/state.json`: the tab the dashboard was left on. */
export const userStateStore = createConfigStore<{ tab: TabId }>({
  appName: 'pkgi',
  kind: 'state',
  defaults: { tab: 'packages' },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
  }),
});

/** Everything pkgi knows about the folder it runs in, loaded once per open. */
export interface FolderContext {
  dir: string;
  project: ProjectConfigResult;
  statePath: string;
  state: FolderState;
  settings: FolderSettings;
}

export const loadFolderContext = async (dir: string): Promise<FolderContext> => {
  const project = await loadProjectConfig(dir);
  const statePath = folderStatePath(dir, project.config);
  const state = await readFolderState(statePath, dir);
  return { dir, project, statePath, state, settings: resolveSettings(project.config, state) };
};
