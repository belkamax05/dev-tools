import type { DependencyType, PackageNote } from '../../config/settings';
import type { CompareColumn } from '../compare';
import type { SupportInfo } from '../eol';
import type { PackageInfo } from '../registry';
import { cleanVersion, compareVersions, type UpdateKind, updateKind } from '../semver';

/** Where a package is declared, and at what. */
export interface ReportLocation {
  /** The folder's label — a column of the Markdown table. */
  folder: string;
  type: DependencyType;
  range: string;
  installed?: string;
}

export interface ReportEntry {
  name: string;
  locations: ReportLocation[];
  latest?: string;
  /** How far the oldest version in use is behind `latest`. */
  update: UpdateKind;
  /** The registry's deprecation message for a version in use. */
  deprecated?: string;
  /** endoflife.date's verdict on the oldest version in use, for the packages it tracks. */
  support?: SupportInfo;
  note?: string;
  links: { npm: string; eol?: string };
  /** When a report first saw it. */
  firstSeenAt: string;
  /** When it stopped being declared anywhere — kept, so a report shows what was dropped. */
  removedAt?: string;
}

export interface ReportFolder {
  label: string;
  /** As given — relative to the folder pkgi ran in, or absolute. */
  path: string;
}

/**
 * `pkgi report`: every package the given folders declare, one entry each, with registry and
 * end-of-life data. Written as JSON (and Markdown); the previous JSON is read back so a package
 * keeps its `firstSeenAt` and a dropped one is kept with a `removedAt`.
 */
export interface Report {
  pkgi: 1;
  generatedAt: string;
  folders: ReportFolder[];
  packages: Record<string, ReportEntry>;
}

/** The versions in use at the locations — installed where installed, else declared — oldest first. */
export const versionsInUse = (locations: ReportLocation[]): string[] =>
  [
    ...new Set(
      locations.map((location) => location.installed ?? cleanVersion(location.range)).filter(Boolean),
    ),
  ].sort(compareVersions);

/** Folder labels: the folder's name, or its path where two share a name. */
export const folderLabels = (paths: string[]): string[] => {
  const names = paths.map((path) => path.replace(/\/+$/, '').split('/').at(-1) || path);
  return names.map((name, at) =>
    name === '.' || names.indexOf(name) !== names.lastIndexOf(name) ? (paths[at] ?? name) : name,
  );
};

/**
 * Read back a previous report — pkgi's, or anything keyed by package name with a `removedAt`
 * (the report this command replaced) — as much of it as the history needs.
 */
export const readPreviousPackages = (
  raw: unknown,
): Record<string, Pick<ReportEntry, 'firstSeenAt' | 'removedAt'>> => {
  const packages = (raw as { packages?: unknown } | undefined)?.packages;
  if (!packages || typeof packages !== 'object') return {};
  const previous: Record<string, Pick<ReportEntry, 'firstSeenAt' | 'removedAt'>> = {};
  for (const [name, value] of Object.entries(packages as Record<string, unknown>)) {
    const entry = (value ?? {}) as { firstSeenAt?: unknown; removedAt?: unknown };
    previous[name] = {
      firstSeenAt: typeof entry.firstSeenAt === 'string' ? entry.firstSeenAt : '',
      removedAt: typeof entry.removedAt === 'string' ? entry.removedAt : undefined,
    };
  }
  return previous;
};

export interface BuildReportInput {
  /** One per folder, labelled with {@link folderLabels}. */
  columns: CompareColumn[];
  /** The paths the columns were read from, as given. */
  paths: string[];
  infos: Record<string, PackageInfo>;
  /** Keyed by package name; see {@link versionsInUse} for which version it is about. */
  support: Record<string, SupportInfo | undefined>;
  notes: Record<string, PackageNote>;
  previous: ReturnType<typeof readPreviousPackages>;
  now: string;
}

export const buildReport = ({
  columns,
  paths,
  infos,
  support,
  notes,
  previous,
  now,
}: BuildReportInput): Report => {
  const locations = new Map<string, ReportLocation[]>();
  for (const column of columns) {
    for (const dep of column.manifest.dependencies) {
      const list = locations.get(dep.name) ?? [];
      list.push({
        folder: column.label,
        type: dep.type,
        range: dep.range,
        ...(dep.installed ? { installed: dep.installed } : {}),
      });
      locations.set(dep.name, list);
    }
  }

  const packages: Record<string, ReportEntry> = {};
  for (const name of [...locations.keys()].sort()) {
    const at = locations.get(name) ?? [];
    const versions = versionsInUse(at);
    const info = infos[name];
    const oldest = versions[0] ?? '';
    const deprecated = versions.map((version) => info?.deprecated[version]).find(Boolean);
    const eol = support[name];
    packages[name] = {
      name,
      locations: at,
      ...(info?.latest ? { latest: info.latest } : {}),
      update: updateKind(oldest, info?.latest),
      ...(deprecated ? { deprecated } : {}),
      ...(eol ? { support: eol } : {}),
      ...(notes[name] ? { note: notes[name].note } : {}),
      links: {
        npm: `https://www.npmjs.com/package/${name}`,
        ...(eol ? { eol: eol.source } : {}),
      },
      firstSeenAt: previous[name]?.firstSeenAt || now,
    };
  }

  for (const [name, entry] of Object.entries(previous)) {
    if (packages[name]) continue;
    packages[name] = {
      name,
      locations: [],
      update: 'none',
      links: { npm: `https://www.npmjs.com/package/${name}` },
      firstSeenAt: entry.firstSeenAt || now,
      removedAt: entry.removedAt ?? now,
    };
  }

  return {
    pkgi: 1,
    generatedAt: now,
    folders: columns.map((column, at) => ({ label: column.label, path: paths[at] ?? column.dir })),
    packages: Object.fromEntries(
      Object.entries(packages).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
};

const SHORT_TYPE: Record<DependencyType, string> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
  optionalDependencies: 'opt',
};

/** The one-cell verdict: removed, deprecated, end of life, behind — worst first. */
export const entryStatus = (entry: ReportEntry): string => {
  if (entry.removedAt) return `removed ${entry.removedAt.slice(0, 10)}`;
  const parts: string[] = [];
  if (entry.deprecated) parts.push('DEPRECATED');
  if (entry.support && entry.support.status !== 'supported' && entry.support.status !== 'unknown')
    parts.push(entry.support.summary);
  if (entry.update !== 'none') parts.push(`${entry.update} behind`);
  return parts.join(' · ') || 'ok';
};

/** A location as a table cell: `^18.2.0 (dev)`, with the installed version when it differs. */
export const locationCell = (location: ReportLocation | undefined): string => {
  if (!location) return '—';
  const installed =
    location.installed && location.installed !== cleanVersion(location.range)
      ? ` → ${location.installed}`
      : '';
  const type = location.type === 'dependencies' ? '' : ` (${SHORT_TYPE[location.type]})`;
  return `${location.range}${installed}${type}`;
};

const cell = (text: string) => text.replace(/\|/g, '\\|');

export const renderMarkdown = (report: Report): string => {
  const entries = Object.values(report.packages);
  const active = entries.filter((entry) => !entry.removedAt);
  const labels = report.folders.map((folder) => folder.label);
  const lines = [
    '# Dependencies Report',
    '',
    `Generated by \`pkgi report\` on ${report.generatedAt} from ${report.folders
      .map((folder) => `\`${folder.path}\``)
      .join(', ')}.`,
    '',
    `| Package | ${labels.map(cell).join(' | ')} | Latest | Status |`,
    `| --- | ${labels.map(() => '---').join(' | ')} | --- | --- |`,
    ...entries.map((entry) => {
      const cells = labels.map((label) =>
        locationCell(entry.locations.find((location) => location.folder === label)),
      );
      return `| [${cell(entry.name)}](${entry.links.npm}) | ${cells.map(cell).join(' | ')} | ${
        entry.latest ?? '—'
      } | ${cell(entryStatus(entry))} |`;
    }),
    '',
    '## Statistics',
    '',
    `- **Total packages:** ${entries.length}`,
    `- **Active:** ${active.length}`,
    `- **Removed:** ${entries.length - active.length}`,
    `- **Behind latest:** ${active.filter((entry) => entry.update !== 'none').length}`,
    `- **Deprecated:** ${active.filter((entry) => entry.deprecated).length}`,
    `- **End of life / ending:** ${
      active.filter(
        (entry) => entry.support?.status === 'eol' || entry.support?.status === 'ending',
      ).length
    }`,
    '',
  ];
  const noted = active.filter((entry) => entry.note);
  if (noted.length) {
    lines.push('## Notes', '');
    for (const entry of noted) lines.push(`- **${entry.name}**: ${entry.note}`);
    lines.push('');
  }
  const supported = active.filter((entry) => entry.support);
  if (supported.length) {
    lines.push(
      '## Support',
      '',
      'From endoflife.date where it publishes a window; otherwise "stale" from npm release dates.',
      '',
    );
    for (const entry of supported) {
      lines.push(
        `- **${entry.name}**: ${entry.support?.summary}${entry.support?.lts ? ' (LTS)' : ''} — ${
          entry.support?.source
        }`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
};
