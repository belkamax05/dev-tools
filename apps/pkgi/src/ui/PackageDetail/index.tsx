import { Text } from 'ink';
import type { ReactNode } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import type { ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import type { SupportInfo } from '../../core/eol';
import type { Dependency } from '../../core/manifest';
import type { PackageRow } from '../../core/packages';
import {
  getPackageInfo,
  getVersionDetails,
  type PackageInfo,
  type SearchResult,
  type VersionDetails,
} from '../../core/registry';
import { compareVersions, isPrerelease, updateKind } from '../../core/semver';
import { getPackageSupport, STALE_PACKAGE_MS, STALE_VERSION_MS } from '../../core/support';

/**
 * The buttons for a registry result: add the chosen version either way, or choose another. Two
 * buttons rather than a prod/dev switch — the choice is made by the button pressed. "Other
 * version…" works like a dropdown: it comes back here with the pick in the add buttons, and
 * "Latest" puts them back on the suggested version.
 */
export const addActions = (
  result: Pick<SearchResult, 'name' | 'version'>,
  chosen: string | undefined,
  {
    add,
    choose,
    reset,
  }: {
    add: (name: string, version: string | undefined, dev: boolean) => void;
    choose: () => void;
    reset: () => void;
  },
): ToolbarAction[] => [
  {
    hotkey: 'i',
    label: `Add ${chosen ?? result.version} · prod`,
    onPress: () => add(result.name, chosen, false),
    tone: 'primary',
  },
  {
    hotkey: 'd',
    label: `Add ${chosen ?? result.version} · dev`,
    onPress: () => add(result.name, chosen, true),
  },
  { hotkey: 'v', label: chosen ? `Version: ${chosen}…` : 'Other version…', onPress: choose },
  ...(chosen ? [{ hotkey: 'l', label: `Latest (${result.version})`, onPress: reset }] : []),
  {
    hotkey: 'w',
    label: 'npm page',
    onPress: () => openUrl(`https://www.npmjs.com/package/${result.name}`),
  },
];

type Colors = ReturnType<typeof useColors>;
export type SupportColors = Pick<Colors, 'error' | 'warn' | 'ok' | 'muted'>;

export const supportColor = (support: SupportInfo | undefined, colors: SupportColors) =>
  support?.status === 'eol'
    ? colors.error
    : support?.status === 'ending' || support?.status === 'stale'
      ? colors.warn
      : support?.status === 'supported'
        ? colors.ok
        : colors.muted;

/** Days since `published`, or undefined when there is no usable date. */
const ageDays = (published: string | undefined, now: number) => {
  const date = published ? Date.parse(published) : Number.NaN;
  return Number.isFinite(date) ? Math.max(0, Math.floor((now - date) / 86400000)) : undefined;
};

/** The header of the versions table, aligned with `versionCells`. */
export const versionHeader = (versionWidth: number) =>
  ['Version'.padEnd(versionWidth), 'Published'.padEnd(10), 'Age'.padStart(6)].join('  ');

/** One row of the versions table: version, publish date and age in fixed columns. */
export const versionCells = (
  version: string,
  published: string | undefined,
  versionWidth: number,
  now = Date.now(),
) => {
  const cell = version.length > versionWidth ? version.slice(0, versionWidth - 1) + '…' : version;
  const days = ageDays(published, now);
  return [
    cell.padEnd(versionWidth),
    (days === undefined ? '?' : (published as string).slice(0, 10)).padEnd(10),
    (days === undefined ? '?' : days + 'd').padStart(6),
  ].join('  ');
};

type Tone = 'ok' | 'warn' | 'error' | 'muted' | 'highlight';

export interface VersionLine {
  label: string;
  version: string;
  published?: string;
  status: string;
  tone: Tone;
}

const updateTone = (kind: string): Tone =>
  kind === 'major' ? 'error' : kind === 'minor' ? 'warn' : kind === 'patch' ? 'ok' : 'muted';

/**
 * Every version worth knowing about for a package, each once: what is installed, the newest on
 * its major, `latest`, a tagged prerelease and the highest ever published — a row is left out
 * when it would only repeat a version already listed. A `candidate` — a package not added yet —
 * has nothing installed, so it starts at `latest`.
 */
export const versionLines = (
  row: PackageRow,
  support: SupportInfo | undefined,
  now = Date.now(),
  candidate = false,
): VersionLine[] => {
  const metrics = support?.maintenance;
  const installedAge = ageDays(metrics?.installedPublished, now);
  const lines: VersionLine[] = candidate
    ? []
    : [
    {
      label: 'Installed',
      version: row.installed ?? '—',
      published: row.installed ? metrics?.installedPublished : undefined,
      ...(row.local
        ? { status: 'local dependency — no registry data', tone: 'muted' as const }
        : !row.installed
          ? { status: 'not in node_modules — run an install', tone: 'warn' as const }
          : row.mismatch
            ? { status: 'not what package.json declares — reinstall', tone: 'warn' as const }
            : installedAge === undefined
              ? { status: 'publish date unknown', tone: 'muted' as const }
              : installedAge * 86400000 > STALE_VERSION_MS
                ? { status: 'stale · released over 365d ago', tone: 'warn' as const }
                : { status: 'ok · stale after 365d', tone: 'ok' as const }),
    },
  ];
  if (row.local) return lines;

  const shown = new Set([row.installed, row.latest]);
  if (
    !candidate &&
    metrics?.lineVersion &&
    metrics.major !== undefined &&
    !shown.has(metrics.lineVersion)
  ) {
    const kind = updateKind(row.current, metrics.lineVersion);
    lines.push({
      label: `Latest on ${metrics.major}`,
      version: metrics.lineVersion,
      published: metrics.linePublished,
      status: kind === 'none' ? 'newest on this major' : `${kind} update`,
      tone: updateTone(kind),
    });
  }

  if (row.info?.error === 'not-found')
    lines.push({
      label: 'Latest',
      version: '—',
      status: 'not on the registry (private, or a local package)',
      tone: 'muted',
    });
  else if (row.latest) {
    const behind = metrics?.majorGap ?? 0;
    lines.push({
      label: 'Latest',
      version: row.latest,
      published: metrics?.latestPublished,
      status: candidate
        ? 'latest · what [i] adds'
        : row.update === 'none'
          ? 'up to date'
          : `${row.update} update${behind > 1 ? ` · ${behind} majors behind` : ''}`,
      tone: updateTone(row.update),
    });
  } else
    lines.push({ label: 'Latest', version: '?', status: row.info?.error ?? 'checking…', tone: 'muted' });

  if (row.prerelease) {
    shown.add(row.prerelease);
    lines.push({
      label: 'Prerelease',
      version: row.prerelease,
      published: metrics?.nextPublished,
      status: `tagged ${row.prereleaseTag}`,
      tone: 'highlight',
    });
  }
  if (metrics?.highestVersion && !shown.has(metrics.highestVersion))
    lines.push({
      label: 'Highest',
      version: metrics.highestVersion,
      published: metrics.highestPublished,
      status: isPrerelease(metrics.highestVersion) ? 'prerelease' : 'highest published',
      tone: 'highlight',
    });
  return lines;
};

/**
 * A package that is not in `package.json` yet, as a row the detail panel can draw: judged as if
 * `latest` were what gets added, which is what [i] adds.
 */
export const candidateRow = (
  name: string,
  info: PackageInfo,
  showUnstable: boolean,
): PackageRow => {
  const current = info.latest ?? '';
  const next = showUnstable ? info.next : undefined;
  return {
    name,
    range: '',
    type: 'dependencies',
    local: false,
    current,
    info,
    latest: info.latest,
    update: 'none',
    prerelease: next && current && compareVersions(next, current) > 0 ? next : undefined,
    prereleaseTag: next ? info.nextTag : undefined,
    deprecated: current ? info.deprecated[current] : undefined,
    mismatch: false,
  };
};

/** Wide enough for "Latest on 12" plus the one-space gap every label keeps before its value. */
const LABEL_WIDTH = 14;

const Field = ({ label, children }: { label: string; children: ReactNode }) => {
  const colors = useColors();
  return (
    <Box flexDirection="row">
      <Box width={LABEL_WIDTH} flexShrink={0} paddingRight={1}>
        <Text color={colors.muted} wrap="truncate">
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
};

/**
 * Everything known about one package: versions with their publish dates, release activity,
 * support, license and links. A `candidate` is a registry result not added yet; `declared` is
 * what `package.json` says about it, when it does.
 */
export const PackageDetail = ({
  row,
  support,
  registry,
  candidate = false,
  declared = candidate ? undefined : row,
}: {
  row: PackageRow;
  support?: SupportInfo;
  registry: string;
  candidate?: boolean;
  declared?: Pick<Dependency, 'range' | 'type' | 'installed'>;
}) => {
  const colors = useColors();
  const { data: details } = useLoader(
    (): VersionDetails | Promise<VersionDetails> =>
      row.local ? {} : getVersionDetails(row.name, row.latest ?? row.current, registry),
    [row.name, row.latest, row.current, registry],
  );
  const metrics = support?.maintenance;
  const now = Date.now();
  const lines = versionLines(row, support, now, candidate);
  const versionWidth = Math.min(18, Math.max(7, ...lines.map((line) => line.version.length)));
  const lastAge = ageDays(metrics?.lastPublished, now);
  //? Home and Repo are often the same page (a GitHub README) — one link then, not two
  const homepage = details?.homepage;
  const repo =
    details?.repository && details.repository !== homepage?.replace(/#.*$/, '')
      ? details.repository
      : undefined;
  const links = [
    ...(homepage ? [{ label: 'Home', url: homepage }] : []),
    ...(repo ? [{ label: 'Repo', url: repo }] : []),
    ...(row.local ? [] : [{ label: 'npm', url: `https://www.npmjs.com/package/${row.name}` }]),
  ];
  return (
    <Box flexDirection="column">
      <Text bold color={colors.heading} wrap="truncate">
        {row.name}
      </Text>
      {details?.description && (
        <Text color={colors.muted} wrap="wrap">
          {details.description}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Field label="Declared">
          {declared ? (
            <Text color={candidate ? colors.accent : colors.text} wrap="truncate">
              {`${declared.range} in ${declared.type}${
                candidate && declared.installed ? ` (${declared.installed} installed)` : ''
              }`}
            </Text>
          ) : (
            <Text color={colors.muted} wrap="truncate">
              not in package.json
            </Text>
          )}
        </Field>
        {row.override && (
          <Field label="Pinned">
            <Text color={colors.warn} wrap="wrap">
              {`${row.override.value} by "${row.override.field}" in ${row.override.file} — installed whatever the range says; updates move it too`}
            </Text>
          </Field>
        )}
        <Box marginY={1} flexDirection="column">
          <Field label="">
            <Text color={colors.muted} wrap="truncate">
              {versionHeader(versionWidth)}
            </Text>
          </Field>
          {lines.map((line) => (
            <Field key={line.label} label={line.label}>
              <Text color={colors[line.tone]} wrap="truncate">
                {`${versionCells(line.version, line.published, versionWidth, now)}  ${line.status}`}
              </Text>
            </Field>
          ))}
        </Box>
        {!row.local && (
          <Field label="Activity">
            <Text
              color={
                lastAge === undefined
                  ? colors.muted
                  : lastAge * 86400000 > STALE_PACKAGE_MS
                    ? colors.warn
                    : colors.ok
              }
              wrap="truncate"
            >
              {lastAge === undefined
                ? 'release dates unavailable'
                : `last release ${metrics?.lastPublished?.slice(0, 10)} · ${lastAge}d ago · stale after 730d`}
            </Text>
          </Field>
        )}
        <Field label="Support">
          {support ? (
            <Text color={supportColor(support, colors)} wrap="wrap">
              {`${support.status.toUpperCase()}: ${support.summary}${support.lts ? ' (LTS)' : ''} · ${
                support.basis === 'endoflife'
                  ? `endoflife.date/${support.product}`
                  : 'npm release dates'
              }`}
            </Text>
          ) : (
            <Text color={colors.muted} wrap="wrap">
              {row.local
                ? 'Local dependency — EOL information unavailable.'
                : 'No confirmed EOL information for this release line.'}
            </Text>
          )}
        </Field>
        {details?.license && (
          <Field label="License">
            <Text color={colors.muted}>{details.license}</Text>
          </Field>
        )}
        {links.map((link) => (
          <LinkRow
            key={link.label}
            label={link.label}
            labelWidth={LABEL_WIDTH}
            value={link.url}
            color={colors.muted}
            onOpen={() => openUrl(link.url)}
          />
        ))}
      </Box>
      {row.deprecated && (
        <Box marginTop={1}>
          <Text color={colors.error} wrap="wrap">{`Deprecated: ${row.deprecated}`}</Text>
        </Box>
      )}
      {row.note && (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.accent}>Note</Text>
          <Text color={colors.text} wrap="wrap">
            {row.note}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * The detail panel for a package found on the registry rather than in `package.json`: the same
 * versions table, activity and support as an installed one, loaded when it is selected.
 */
export const RegistryPackageDetail = ({
  name,
  dir,
  registry,
  cacheHours,
  showUnstable,
  declared,
}: {
  name: string;
  dir: string;
  registry: string;
  cacheHours: number;
  showUnstable: boolean;
  /** Already in `package.json` — the Add tab can find packages the folder has. */
  declared?: Dependency;
}) => {
  const colors = useColors();
  const { data, error } = useLoader(async () => {
    const info = await getPackageInfo(name, {
      registry,
      maxAgeMs: cacheHours * 3600_000,
      cwd: dir,
    });
    const row = candidateRow(name, info, showUnstable);
    const support = row.current
      ? await getPackageSupport(name, row.current, info, { registry })
      : undefined;
    return { row, support };
  }, [name, dir, registry, cacheHours, showUnstable]);

  if (error)
    return <Text color={colors.error} wrap="wrap">{`Could not read ${name}: ${error}`}</Text>;
  if (!data || data.row.name !== name)
    return <Text color={colors.muted}>{`Asking the registry about ${name}…`}</Text>;
  return <PackageDetail row={data.row} support={data.support} registry={registry} declared={declared} candidate />;
};
