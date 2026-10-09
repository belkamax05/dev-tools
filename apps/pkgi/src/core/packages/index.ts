import type { FolderSettings, PackageNote } from '../../config/settings';
import { detectPackageManager, type Dependency, type Manifest } from '../manifest';
import { getManyPackageInfo, type PackageInfo } from '../registry';
import { cleanVersion, compareVersions, updateKind, type UpdateKind } from '../semver';

/** One row of the Packages tab and of `pkgi list`: what is declared, installed and available. */
export interface PackageRow extends Dependency {
  /** What the comparisons are made from: the installed version, else the range's version. */
  current: string;
  info?: PackageInfo;
  latest?: string;
  /** How far `current` is behind `latest`. */
  update: UpdateKind;
  /** A prerelease ahead of `current` — only filled in when prereleases are shown. */
  prerelease?: string;
  prereleaseTag?: string;
  /** The registry's deprecation message for the version in use. */
  deprecated?: string;
  note?: string;
  /** Installed version no longer satisfies — or never matched — what is declared (roughly: a different major). */
  mismatch: boolean;
}

export const isOutdated = (row: PackageRow): boolean =>
  row.update !== 'none' || Boolean(row.prerelease);

/** Join a manifest with registry answers and the folder's notes. */
export const buildRows = (
  manifest: Manifest,
  infos: Record<string, PackageInfo>,
  notes: Record<string, PackageNote>,
  settings: Pick<FolderSettings, 'showUnstable'>,
): PackageRow[] =>
  manifest.dependencies.map((dep) => {
    const current = dep.installed ?? cleanVersion(dep.range);
    const info = dep.local ? undefined : infos[dep.name];
    const latest = info?.latest;
    const next = settings.showUnstable ? info?.next : undefined;
    const declared = cleanVersion(dep.range);
    return {
      ...dep,
      current,
      info,
      latest,
      update: dep.local ? 'none' : updateKind(current, latest),
      prerelease: next && compareVersions(next, current) > 0 ? next : undefined,
      prereleaseTag: next ? info?.nextTag : undefined,
      deprecated: info?.deprecated[current],
      note: notes[dep.name]?.note,
      mismatch: Boolean(
        dep.installed &&
          declared &&
          !dep.local &&
          cleanVersion(dep.installed).split('.')[0] !== declared.split('.')[0],
      ),
    };
  });

/** Registry answers for every registry-backed dependency of a manifest. */
export const fetchInfos = async (
  manifest: Manifest,
  settings: Pick<FolderSettings, 'registry' | 'cacheHours'> &
    Pick<Partial<FolderSettings>, 'packageManager'>,
  {
    force = false,
    onProgress,
  }: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<Record<string, PackageInfo>> => {
  const manager = await detectPackageManager(manifest.dir, settings.packageManager);
  return getManyPackageInfo(
    [...new Set(manifest.dependencies.filter((dep) => !dep.local).map((dep) => dep.name))],
    {
      registry: settings.registry,
      maxAgeMs: settings.cacheHours * 3600_000,
      force,
      cwd: manifest.dir,
      packageManager: manager.name,
    },
    onProgress,
  );
};
