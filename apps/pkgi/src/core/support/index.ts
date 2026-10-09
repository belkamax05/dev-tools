import { ENDOFLIFE_PRODUCTS, getSupport, type SupportInfo } from '../eol';
import { getReleaseActivity, type PackageInfo } from '../registry';
import { parseVersion } from '../semver';

const DAY_MS = 24 * 60 * 60 * 1000;
/** No release at all for this long: the package itself looks abandoned. */
export const STALE_PACKAGE_MS = 2 * 365 * DAY_MS;
/** The exact version in use was published this long ago, while latest is two majors ahead. */
export const STALE_VERSION_MS = 365 * DAY_MS;
/** How far ahead `latest` must be for the installed-version age rule. */
export const STALE_VERSION_MAJORS = 2;

const month = (iso: string) => iso.slice(0, 7);

/**
 * A verdict from release dates, for a package no vendor publishes a support window for. Only
 * ever `stale` or nothing: a recent release proves activity, not support, so a package that
 * passes is left without a verdict rather than called supported.
 */
export const assessMaintenance = ({
  name,
  current,
  latest,
  lastPublished,
  installedPublished,
  now = Date.now(),
}: {
  name: string;
  current: string;
  latest?: string;
  lastPublished?: string;
  installedPublished?: string;
  now?: number;
}): SupportInfo | undefined => {
  const source = `https://www.npmjs.com/package/${name}?activeTab=versions`;
  const stale = (summary: string, cycle?: string): SupportInfo => ({
    status: 'stale',
    product: 'npm',
    basis: 'registry',
    ...(cycle ? { cycle } : {}),
    summary,
    lts: false,
    source,
  });

  if (lastPublished && now - Date.parse(lastPublished) > STALE_PACKAGE_MS)
    return stale(`no release since ${month(lastPublished)}`);

  const used = parseVersion(current)?.major;
  const newest = latest ? parseVersion(latest)?.major : undefined;
  if (used === undefined || newest === undefined || newest - used < STALE_VERSION_MAJORS) return;
  const last = installedPublished;
  if (last && now - Date.parse(last) > STALE_VERSION_MS) {
    return stale(
      `${current} published ${month(last)}, ${newest - used} majors behind`,
      String(used),
    );
  }
  return undefined;
};

/** Whether the major-version gap meets the installed-version stale threshold. */
export const needsReleaseLines = (current: string, latest?: string): boolean => {
  const used = parseVersion(current)?.major;
  const newest = latest ? parseVersion(latest)?.major : undefined;
  return used !== undefined && newest !== undefined && newest - used >= STALE_VERSION_MAJORS;
};

/**
 * Whether the version in use is still supported: endoflife.date's published window for the
 * packages it tracks, and for every other one — or a line endoflife.date doesn't list — a
 * judgement from exact registry publish dates. Unknown verdicts retain their measurements.
 */
export const getPackageSupport = async (
  name: string,
  current: string,
  info: PackageInfo | undefined,
  { registry, force = false }: { registry: string; force?: boolean },
): Promise<SupportInfo | undefined> => {
  if (!current) return undefined;
  const published = ENDOFLIFE_PRODUCTS[name] ? await getSupport(name, current, force) : undefined;
  if (!info || info.error) return published;
  const activity = await getReleaseActivity(name, registry, force);
  const major = parseVersion(current)?.major;
  const newest = info.latest ? parseVersion(info.latest)?.major : undefined;
  const maintenance = {
    lastPublished: activity?.lastPublished,
    installedPublished: activity?.published[current],
    linePublished: major === undefined ? undefined : activity?.lines[major],
    major,
    majorGap: major === undefined || newest === undefined ? undefined : Math.max(0, newest - major),
  };
  const verdict =
    published && published.status !== 'unknown'
      ? published
      : assessMaintenance({
          name,
          current,
          latest: info.latest,
          lastPublished: activity?.lastPublished,
          installedPublished: maintenance.installedPublished,
        });
  return {
    ...(verdict ?? {
      status: 'unknown',
      product: 'npm',
      basis: 'registry',
      summary: 'No confirmed EOL information',
      lts: false,
      source: `https://www.npmjs.com/package/${name}?activeTab=versions`,
    }),
    maintenance,
  };
};

/** Many at once, a few in flight — the full documents behind the line check can be large. */
export const getManyPackageSupport = async (
  packages: { name: string; current: string; info?: PackageInfo }[],
  options: { registry: string; force?: boolean },
  concurrency = 8,
): Promise<Record<string, SupportInfo>> => {
  const out: Record<string, SupportInfo> = {};
  let next = 0;
  const worker = async () => {
    while (next < packages.length) {
      const item = packages[next++];
      if (!item) continue;
      const support = await getPackageSupport(item.name, item.current, item.info, options);
      if (support) out[item.name] = support;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, packages.length) }, worker));
  return out;
};

/** Needs attention: past or near its end, or looks abandoned. */
export const isUnsupported = (support: SupportInfo | undefined): boolean =>
  support?.status === 'eol' || support?.status === 'ending' || support?.status === 'stale';

/** A few characters for a list row or table cell: `EOL`, `EOL 2026-10-21`, `stale`, `→ 2027-04`. */
export const supportLabel = (support: SupportInfo | undefined): string => {
  if (!support) return '';
  switch (support.status) {
    case 'eol':
      return 'EOL';
    case 'ending':
      return `EOL ${support.until ?? 'soon'}`;
    case 'stale':
      return 'stale';
    case 'supported':
      return support.until ? `→ ${support.until.slice(0, 7)}` : 'supported';
    default:
      return '';
  }
};
