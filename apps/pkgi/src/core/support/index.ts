import { ENDOFLIFE_PRODUCTS, getSupport, type SupportInfo } from '../eol';
import { getReleaseLines, type PackageInfo, type ReleaseLines } from '../registry';
import { parseVersion } from '../semver';

const DAY_MS = 24 * 60 * 60 * 1000;
/** No release at all for this long: the package itself looks abandoned. */
export const STALE_PACKAGE_MS = 2 * 365 * DAY_MS;
/** The line in use got no release for this long, while the package moved on by two majors or more. */
export const STALE_LINE_MS = 365 * DAY_MS;
/** How far ahead `latest` has to be before an old line is judged — one major is normal lag. */
export const STALE_LINE_MAJORS = 2;

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
  modified,
  lines,
  now = Date.now(),
}: {
  name: string;
  current: string;
  latest?: string;
  modified?: string;
  lines?: ReleaseLines;
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

  if (modified && now - Date.parse(modified) > STALE_PACKAGE_MS)
    return stale(`no release since ${month(modified)}`);

  const used = parseVersion(current)?.major;
  const newest = latest ? parseVersion(latest)?.major : undefined;
  if (used === undefined || newest === undefined || newest - used < STALE_LINE_MAJORS) return;
  const last = lines?.[used];
  if (last && now - Date.parse(last) > STALE_LINE_MS) {
    return stale(
      `${used}.x last released ${month(last)}, ${newest - used} majors behind`,
      String(used),
    );
  }
  return undefined;
};

/** Worth the full registry document: far enough behind for the line check to apply at all. */
export const needsReleaseLines = (current: string, latest?: string): boolean => {
  const used = parseVersion(current)?.major;
  const newest = latest ? parseVersion(latest)?.major : undefined;
  return used !== undefined && newest !== undefined && newest - used >= STALE_LINE_MAJORS;
};

/**
 * Whether the version in use is still supported: endoflife.date's published window for the
 * packages it tracks, and for every other one — or a line endoflife.date doesn't list — a
 * judgement from the registry's release dates. Undefined when there is nothing to say.
 */
export const getPackageSupport = async (
  name: string,
  current: string,
  info: PackageInfo | undefined,
  { registry, force = false }: { registry: string; force?: boolean },
): Promise<SupportInfo | undefined> => {
  if (!current) return undefined;
  if (ENDOFLIFE_PRODUCTS[name]) {
    const published = await getSupport(name, current, force);
    if (published && published.status !== 'unknown') return published;
  }
  if (!info || info.error) return undefined;
  const lines = needsReleaseLines(current, info.latest)
    ? await getReleaseLines(name, registry, force)
    : undefined;
  return assessMaintenance({
    name,
    current,
    latest: info.latest,
    modified: info.modified,
    lines,
  });
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
